+++
title = 'Flash Attention'
draft = false
date = 2024-08-22
interests = ["embedded", "rust"]
github = "https://github.com/AdinAck/stm32g4xx-hal/blob/main/src/cordic.rs"
featured = true
math = true
summary = "One of the most intersting optimizations that also seemimly "
+++

Embedded Rust provides a unique opportunity for us -- as embedded systems designers -- to design safer, more robust, and highly adaptable
**H**ardware **A**bstraction **L**ayers (HALs).

Many Embedded Rust HAL projects exist and are actively worked on, I've contributed to my fair share of them in the past years, but during
this time I was always left yearning for more. Yearning for greater invariance, stability, and static analysis.

So that's what I've set out to do, design a system, process, or guideline for designing HALs that fully leverage Rust's capabilities.

To explore some of my ideas, and give a go at laying out this "prototype" HAL, (we can call it proto-hal) let's design a HAL component
for a peripheral from the ground up.

I am doing some work with the G4 that would benefit from accelerated trigonometric functions, so let's create an interface for the
CORDIC co-processor.

## Understanding the Peripheral

The first step is to look at any relevant documentation on the peripheral, to fully understand the scope of its operation.

The G4 reference manual [RM0440](https://www.st.com/resource/en/reference_manual/rm0440-stm32g4-series-advanced-armbased-32bit-mcus-stmicroelectronics.pdf)
and CORDIC application note [AN5325](https://www.st.com/resource/en/application_note/an5325-how-to-use-the-cordic-to-perform-mathematical-functions-on-stm32-mcus-stmicroelectronics.pdf) should be useful.

Let's see what it can do.

![](https://cdn.adinack.dev/better-hals-first-look/all-functions.png)
> \$RM0440 17.3.2

This is the list of available functions. It seems they have varying numbers of arguments and results.

Neat, to see how we actually program this thing, let's look at the register map:

![](https://cdn.adinack.dev/better-hals-first-look/register-map.png)
> $RM0440 17.4.4

So there are three registers, just looking at this map it seems pretty clear that the first
register `CSR` is some kinid of configuration register, `WDATA` holds an `ARG` so that's probably
where we **W**rite our arguments, and `RDATA` holds a `RES` so it is probably where we **R**ead
computation results.

Let's break down the function of each property of the `CSR` register.

### RRDY

This bit indicates if a result is pending in the output register `RDATA`.

It's set and cleared by hardware, and can be used by software to determine
if results are ready to be read.

### ARGSIZE

The Cordic co-processor supports two data types:
- q1.31
- q1.15

These are *fixed-point* types, meaning the decimal point
is at a fixed bit position. In this case, there is one bit to indicate sign,
and 31 or 15 bits representing fractional components. Both of these types
occupy 32 and 16 bits respectively.

So this bit is how the software controls the data type to be used for
function arguments.

### RESSIZE

Just like [ARGSIZE](#argsize), this bit controls the data type to be used
for function results.

### NARGS

Since there are different data types of different sizes, and different functions
with differing input counts, the peripheral can accept a configurable number of
writes to the argument register.

Consider a function like atan2 which has an $x$ and $y$ input. If we also select
the q1.31 datatype, clearly these two arguments will not fit in the `WDATA` register
which has a width of 32 bits.

In this case, we would need to write the arguments successively. The CORDIC must be
configured to accept this, with this (`NARGS`) register.

### NRES

Just like [NARGS](#nargs), the number of *reads* from the `RDATA` register to be considered
a complete read of the function results, is configured with this bit.

### IEN

The Cordic is capable of generating interrupts upon evaluation completion.

Whether or not it *should* is configured with this bit.

### SCALE

Some functions benefit from having a software configurable scaling factor applied to
the function arguments.

This bitfield represents $n$, resulting in a scaling factor of $2^{-n}$.

### PRECISION

The Cordic algorithm is iterative, we can configure the *number* of iterations
with this bitfield.

### FUNC

Lastly, this bitfield allows us to select which function we want performed by the peripheral.

---

Nice, these are some pretty simple properties to configure.

## Direct Registers

Let's use the `stm32-pac` (peripheral access crate) to try configuring the Cordic.

```rust
fn configure_cordic(rb: stm32::cordic::CORDIC) {
    // ...
}
```

Imagine we are in a scope where the PAC-level resource is accessible.

We can access the `CSR` register with a `RegisterBlock` writer:

```rust
fn configure_cordic(rb: stm32::cordic::CORDIC) {
    rb.csr.write(|w| {
        // ...
    });
}
```

Fortunately for us, the SVD[^1] files provide us with register names, bitfields, enums, etc.

Let's try configuring the function:

```rust
fn configure_cordic(rb: stm32::cordic::CORDIC) {
    rb.csr.write(|w| w.func().sine());
}
```

How does that work? Rust already knows how to use the Cordic?

*Kind of!*

The PAC does provide a very useful direct interface to the register bitfields.

It *does not*, however, enforce or represent any behavioral logic. It's just a nice interface
for reading from and writing to registers.

But this is a good starting point, here's an example of why this isn't good enough:

```rust
fn configure_cordic(rb: stm32::cordic::CORDIC) {
    rb.csr.write(|w| {
        w.argsize().bits16();
            .ressize().bits32();
            .nargs().num2();
            .nres().num1();
            .func().sine();
            .scale().bits(0);

        unsafe { w.precision().bits(15) }
    });
}
```

This is a full configuration of the peripheral. Looks fine doesn't it. It certainly compiles.

Can you see the problem?

The problem is we set `ARGSIZE` to `bits16` *and* `NARGS` to `num2`. In English,
we told the Cordic to expect two register writes of q1.15 arguments... which is *impossible*.

Two q1.15 arguments are supposed to be stored in a single word and written once.

So we put the peripheral in an invalid state and had no idea!

Here's an even worse scenario:

```rust
fn configure_cordic(rb: stm32::cordic::CORDIC) {
    // configured in some way...
}

fn use_cordic(rb: stm32::cordic::CORDIC) {
    rb.wdata.write(|w| w.arg().bits(0x7000));

    let result = rb.rdata.read().res().bits();
}
```

The peripheral was configured at some point, and we are
trying to use it later to evaluate our arguments.

*What is the value of result?*

It's a trick question!

Nothing about the **type** of `rb` indicates to us how the Cordic was configured.

Does it expect two register writes? What data type was it configured to? What function
is it going to run?

Yeah... this is bad...

So how can we do better?

How can we leverage Rust's type system to represent these configurations
and enforce valildity?

## Type-States

Let's outline some fundamental ideas to get us started.

### State

We will create types which directly correspond to specific hardware states called **type-states**.

Usually the hardware states will be in the form of register bitfields.

Type-states will implement a trait that looks like this:

```rust
trait State {
    const RAW: Raw;

    fn set(binding: Binding) -> Self;
}
```

The const `RAW` will hold the type-states bitfield value.

The function `set` will accept a binding that provides write access
to the appropriate bitfield, and return the type-state.

The latter aspect is important because if instances of type-states
can only exist when the hardware is configured to represent them,
we can make any process or type *own* the type-states it requires,
for compile-time enforcement.

Let's implement our type-states now:

### ArgSize/ResSize

The first bitfields of the Cordic control register are for the argument and result size (type).

Recall, there are two possible types: q1.31 or q1.15. We can create types to represent this:

```rust
/// q1.15 fixed point number.
pub struct Q15;
/// q1.31 fixed point number.
pub struct Q31;
```

Really, we *should* use types from the `fixed` crate for the interfaces we will create, but
to avoid massive type signature cluttering, we can use the above types as `Tag`s for the actual
fixed types:

```rust
/// Extension trait for fixed point types.
trait Ext: Fixed {
    /// Tag representing this type.
    type Tag: Tag<Repr = Self>;
}

/// Trait for tags to represent Cordic argument or result data.
trait Tag {
    /// Internal fixed point representation.
    type Repr: Ext<Tag = Self>;
}
```

...and implement them:

```rust
impl Ext for I1F15 {
    type Tag = Q15;
}

impl Ext for I1F31 {
    type Tag = Q31;
}

impl Tag for Q15 {
    type Repr = I1F15;
}

impl Tag for Q31 {
    type Repr = I1F31;
}
```
> `I1F15` and `I1F31` come from `fixed`.

Now, we can create the type-state traits for the `Q15` and `Q31` types:

```rust
mod arg {
    type Raw = csr::ARGSIZE;

    /// Trait for argument type-states.
    trait State: Tag {
        const RAW: Raw;

        fn set(w: csr::ARGSIZE_W<csr::CSRrs>) -> Self;
    }
}

mod res {
    type Raw = csr::RESSIZE;

    /// Trait for result type-states.
    trait State: Tag {
        const RAW: Raw;

        fn set(w: csr::RESSIZE_W<csr::CSRrs>) -> Self;
    }
}
```

...and implement them (with macros):

```rust
macro_rules! impls {
    ( $( ($NAME:ty, $RAW:ident) $(,)? )+ ) => {
        $(
            impl State for $NAME {
                const RAW: Raw = Raw::$RAW;

                fn set(w: csr::ARGSIZE_W<csr::CSRrs>) -> Self {
                    w.variant(Self::RAW);

                    Self
                }
            }
        )+
    };
}

impls! {
    (Q31, Bits32),
    (Q15, Bits16),
}
```
> The result macro is very similar.

### NArgs/NRes

The next bitfields configure the number of register reads/writes expected.

This is a little more complicated, because the value of these type-states is dependent
on others.

For example, if two arguments are to be written of the q1.15 format, only one register write
is needed. But if the data type is q1.31, *two* register writes are needed.

So some kind of "data count" and "data type" information is needed to determine the
number of register interactions.

We have "data type" done, let's add "data count" types to our system.

These won't be type-states, as there is no hardware configuration pertaining
to number of *values* to be passed. So rather than making a `State` trait,
we'll call this a `Property`:

```rust
enum Count {
    One,
    Two,
}

struct One;
struct Two;

trait Property {
    const COUNT: Count;
}

impl Property for One {
    const COUNT: Count = Count::One;
}

impl Property for Two {
    const COUNT: Count = Count::Two;
}
```
> Similarly to how type-states hold a `RAW` const, this property holds a `COUNT` const
> to indicate which count it is statically.

With this, we can create our type-states for register interactions:

```rust
struct NReg<T, Count>
where
    T: types::Tag,
    Count: data_count::Property
{
    _t: PhantomData<T>,
    _count: PhantomData<Count>,
}
```

Let's look at the `State` trait for nargs:

```rust
trait State {
    fn set(w: csr::NARGS_W<csr::CSRrs>) -> Self;
}
```

...and implement it:

```rust
impl<Arg, Count> State for NReg<Arg, Count>
where
    Arg: types::arg::State,
    Count: data_count::Property,
{
    fn set(w: csr::NARGS_W<csr::CSRrs>) -> Self {
        w.variant(
            const {
                match (Arg::RAW, Count::COUNT) {
                    // two registers are needed *only* with two arguments and Q31 size.
                    (types::arg::Raw::Bits32, data_count::Count::Two) => Raw::Num2,
                    (_, _) => Raw::Num1,
                }
            },
        );

        Self {
            _t: PhantomData,
            _count: PhantomData,
        }
    }
}
```
> The implementation for results is very similar.

The body of `set` *looks* like it has runtime branching, but it actually doesn't.

The branching logic is based on associated type constants, so the compiler knows the correct branch
based on the type. An inline `const` is used to explicitly show that this is the case.

### Scale/Precision/Func

These type-states are trivial and follow the same design procedure as the previous.

## Features

Sometimes, the states of a peripheral are too low-level to be meaningfully used one-by-one, as they
work together to fascilitate a *feature* of the peripheral.

In the case of the Cordic, the `NArgs`, `NRes`, `Scale`, and `Func` states are tightly coupled
and fascilitate conducting numerical operations. Certain functions only support certain scales,
the number of desired arguments/results of a function determines the number of register interactions.

To represent these relationships, let's create a **feature** that enforces these relationships:

```rust
trait Feature {
    // states

    /// The required argument register writes.
    type NArgs<Arg>
    where
        Arg: types::arg::State + types::Tag;
    /// The required result register reads.
    type NRes<Res>
    where
        Res: types::res::State + types::Tag;
    /// The scale to be applied.
    type Scale;
    /// The function to evaluate.
    type Func;

    // properties

    /// The number of arguments required.
    type ArgCount;
    /// The number of results produced.
    type ResCount;
}
```

This feature holds **states** and **properties**.

To understand what exactly this feature means, here's an example:

- Name: SinCos
- Argument: angle
- Results: sin(angle) and cos(angle)
- Data Size: q1.31

The register configuration that would support this is:

- NArgs: 1
- NRes: 2
- Scale: 0
- Func: Sine
> Scale value given by $RM0440 17.3.2.

So, a type `SinCos` can be made to represent this operation, and can implement
`Feature` like so:

```rust
impl Feature for SinCos {
    type NArgs<Arg> = NReg<Arg, Self::ArgCount>
    where
        Arg: types::arg::State + types::Tag;
    type NRes<Res> = NReg<Arg, Self::ResCount>
    where
        Res: types::res::State + types::Tag;
    type Scale = N0;
    type Func = Sin;

    type ArgCount = One;
    type ResCount = Two;
}
```
> This implementation covers all permutations of argument and result data type.

Unlike the `Sin` function, some functions have multiple valid scales.

For example, `Sqrt`:

![](https://cdn.adinack.dev/better-hals-first-look/sqrt-params.png)
> $RM0440 17.3.2

As such, this feature type has a generic `Scale`. It will only be implemented for
**valid** scales, of course:

```rust
/// Square root of x.
///
/// This function can be scaled by 0-2.
pub struct Sqrt<Scale: scale::State> {
    _scale: PhantomData<Scale>,
}
```

The implementations are fascilitated by some macros which are invoked like so:

```rust
impls! {
    (Cos<N0>, One, One, Cos),
    (Sin<N0>, One, One, Sin),
    (SinCos<N0>, One, Two, Sin),
    (CosM<N0>, Two, One, Cos),
    (SinM<N0>, Two, One, Sin),
    (SinCosM<N0>, Two, Two, Sin),
    (ATan2<N0>, Two, One, ATan2),
    (Magnitude<N0>, Two, One, Magnitude),
    (ATan2Magnitude<N0>, Two, Two, ATan2),
    (CosH<N1>, One, One, CosH),
    (SinH<N1>, One, One, SinH),
    (SinHCosH<N1>, One, Two, SinH),
    (ATanH<N1>, One, One, ATan),
}

impls_multi_scale! {
    (ATan<N0, N1, N2, N3, N4, N5, N6, N7>, One, One, ATan),
    (Ln<N1, N2, N3, N4>, One, One, Ln),
    (Sqrt<N0, N1, N2>, One, One, Sqrt),
}
```

Which implements `Feature` for the feature types with valid scales.

---

At this point, we have enough to begin creating our Cordic abstraction type.

First, let's define a configuration. This type should hold **all** type-states:

```rust
/// Configuration for the Cordic.
struct Config<Arg, Res, NArgs, NRes, Scale, Prec, Func> {
    arg: Arg,
    res: Res,
    nargs: NArgs,
    nres: NRes,
    scale: Scale,
    prec: Prec,
    func: Func,
}
```
> It is important that the configuration **owns** the type-states, because that
means all instances of `Config` must be valid, as type-state instances can only
be created by calling their `set` method.

And our abstraction type:

```rust
/// Cordic co-processor interface.
pub struct Cordic<Arg, Res, Prec, Op>
where
    Arg: types::arg::State,
    Res: types::res::State,
    Prec: prec::State,
    Op: op::Feature,
{
    rb: CORDIC,
    config: Config<Arg, Res, Op::NArgs<Arg>, Op::NRes<Res>, Op::Scale, Prec, Op::Func>,
}
```

The `Cordic` type has less generic constraints than the `Config` type because the
`Op` feature encodes multiple states.

It is still **guaranteed** that all type-states are accounted for because the config
is present, and per its definition, all type-states are present.

This definition also makes it clear that the `NArgs` and `NRes` type-states
are dependent on the `Arg` and `Res` type-states respectively via the passed
generic constraints.

## Creation

It's time to set up construction of our abstraction.

Firstly, let's define the reset state of the Cordic.

This is a ubiquitous idea across HALs and peripherals, so we should represent
it as a trait in `proto-hal`:

```rust
/// Types that encapsulate a resource that can be configured to be
/// in a "reset" state implement this trait.
pub trait IntoReset {
    /// The form of the implementor type in the "reset" state.
    type Reset;

    /// Transform the implementor type into the "reset" state.
    fn into_reset(self) -> Self::Reset;
}
```

...and implement it:

```rust
/// $RM0440 17.4.1
pub type CordicReset = Cordic<types::Q31, types::Q31, prec::P20, op::Cos>;

impl<Arg, Res, Prec, Op> proto::IntoReset for Cordic<Arg, Res, Prec, Op>
where
    Arg: types::arg::State,
    Res: types::res::State,
    Prec: prec::State,
    Op: op::Feature,
{
    type Reset = CordicReset;

    fn into_reset(self) -> Self::Reset {
        self.freeze()
    }
}
```

And now, we can create an extension trait for the Cordic peripheral that allows
it to be **constrained** by the abstraction type:

> The idea behind constraining is that our abstraction operates within
> a state-space of our creation, effectively *constraining* the state
> of the peripheral to reside within that state-space.

```rust
/// Extension trait for constraining the Cordic peripheral.
pub trait Ext {
    /// Constrain the Cordic peripheral.
    fn constrain(self, rcc: &mut Rcc) -> CordicReset;
}
```

...and implement it:

```rust
impl Ext for CORDIC {
    fn constrain(self, rcc: &mut Rcc) -> CordicReset {
        rcc.rb.ahb1enr().modify(|_, w| {
            w.cordicen().set_bit();
        });

        // SAFETY: we assume the resource is already
        // in a reset state
        // BONUS: this line enforces that the
        // abstraction is of zero-size
        unsafe { core::mem::transmute(()) }
    }
}
```
> The `transmute` has the wonderful side effect of compile-time validating that the
> abstraction is a ZST[^2] as we intend it to be.

## Conversion

Now that the peripheral is constrained by the abstraction, we need a way to
*freeze* the peripheral in desired states. This is how the peripheral is configured.

Let's write a `freeze` method:

```rust
/// Configure the resource as dictated by the resulting
/// type-states. The produced binding represents
/// a frozen configuration, since it is represented
/// by types. A new binding will need to be made --
/// and the old binding invalidated -- in order to change
/// the configuration.
///
/// *Note: The configuration is inferred from context because
/// it is represented by generic type-states.*
pub fn freeze<NewArg, NewRes, NewPrec, NewOp>(self) -> Cordic<NewArg, NewRes, NewPrec, NewOp>
where
    NewArg: types::arg::State,
    NewRes: types::res::State,
    NewPrec: prec::State,
    NewOp: op::Feature,
    NewOp::NArgs<NewArg>: reg_count::arg::State,
    NewOp::NRes<NewRes>: reg_count::res::State,
    NewOp::Scale: scale::State,
    NewOp::Func: func::State,
{
    use func::State as _;
    use reg_count::arg::State as _;
    use reg_count::res::State as _;
    use scale::State as _;

    let config = self.rb.csr().modify(|_, w| Config {
        arg: NewArg::set(w.argsize()),
        res: NewRes::set(w.ressize()),
        nargs: NewOp::NArgs::set(w.nargs()),
        nres: NewOp::NRes::set(w.nres()),
        scale: NewOp::Scale::set(w.scale()),
        prec: NewPrec::set(w.precision()),
        func: NewOp::Func::set(w.func()),
    });

    Cordic {
        rb: self.rb,
        config,
    }
}
```
> `RegisterBlock::write()` is seen returning values here. This is not possible given the original
> implementation in `svd2rust`. I had to fork `svd2rust`, change the interface, and rebuild
> the PAC with the new interface.

This method is extremely robust. Removing any line will cause it to no longer be valid, and it will
not compile. If the type-states were not required to be owned by `Config`, there would be nothing
forcing `set` to be called on every type-state.

## Operation

Now let's set up actually running operations and getting results. We'll start by creating an
`Operation` type:

```rust
/// An operation of the Cordic.
///
/// Enables writing and reading values
/// to and from the Cordic.
struct Operation<'a, Arg, Res, Op>
where
    Arg: types::arg::State,
    Res: types::res::State,
    Op: Feature,
{
    nargs: &'a Op::NArgs<Arg>,
    nres: &'a Op::NRes<Res>,
    scale: &'a Op::Scale,
    func: &'a Op::Func,
}
```

This type ensures the appropriate type-states are set for an operation by *borrowing* them.

Let's implement `write` and `read` methods.

```rust
impl<'a, Arg, Res, Op> Operation<'a, Arg, Res, Op>
where
    Arg: types::arg::State,
    Res: types::res::State,
    Op: Feature,
{
    /// Write arguments to the argument register.
    fn write<Args>(&mut self, args: Args, reg: &crate::stm32::cordic::WDATA)
    where
        Arg: types::Tag,
        Args: ?,
        Op::ArgCount: data_count::Property<Arg>,
    {
        ?
    }

    /// Read results from the result register.
    fn read(
        &mut self,
        reg: &crate::stm32::cordic::RDATA,
    ) -> ?
    where
        Op::ResCount: data_count::Property<Res>,
    {
        ?
    }
}
```

Well we've run into an issue. The argument and return types are dependent on the
operation. So how can we correctly design the function signature to accept and return
those types?

Well, there can be either one or two arguments/results, we already created the `data_count`
properties to reflect that. Let's make an extension trait for types which can be arguments or results:

```rust
mod signature {
    /// The signature is a property of the operation type-state.
    pub trait Property<T>
    where
        T: types::Ext, // arguments/results should be I1F15/I1F31
    {
        /// Write arguments to the argument register.
        ///
        /// # Safety:
        /// Cordic must be configured to expect the
        /// correct number of register writes.
        unsafe fn write(self, reg: &WData)
        where
            T::Tag: types::arg::State;

        /// Read results from the result register.
        ///
        /// # Safety:
        /// Cordic must be configured to expect the
        /// correct number of register reades.
        unsafe fn read(reg: &RData) -> Self
        where
            T::Tag: types::res::State;
    }
}
```