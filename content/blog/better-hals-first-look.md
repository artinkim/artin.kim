+++
title = 'Better HALs: First Look'
draft = false
date = 2024-08-22
interests = ["embedded", "rust"]
github = "https://github.com/AdinAck/stm32g4xx-hal/blob/main/src/cordic.rs"
featured = true
math = true
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

The CORDIC co-processor supports two data types:
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

The CORDIC is capable of generating interrupts upon evaluation completion.

Whether or not it *should* is configured with this bit.

### SCALE

Some functions benefit from having a software configurable scaling factor applied to
the function arguments.

This bitfield represents $n$, resulting in a scaling factor of $2^{-n}$.

### PRECISION

The CORDIC algorithm is iterative, we can configure the *number* of iterations
with this bitfield.

### FUNC

Lastly, this bitfield allows us to select which function we want performed by the peripheral.

---

Nice, these are some pretty simple properties to configure.

## Direct Registers

Let's use the `stm32-pac` (peripheral access crate) to try configuring the CORDIC.

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

How does that work? Rust already knows how to use the CORDIC?

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
we told the CORDIC to expect two register writes of q1.15 arguments... which is *impossible*.

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

Nothing about the **type** of `rb` indicates to us how the CORDIC was configured.

Does it expect two register writes? What data type was it configured to? What function
is it going to run?

Yeah... this is bad...

So how can we do better?

How can we leverage Rust's type system to represent these configurations
and enforce valildity?

## The Power of Types

The first step, is creating our very own type which will hold the CORDIC resource `rb`
and **constrain** its operation to remain within a state-space of our design.

So let's start by defining our type:

```rust
pub struct Cordic {
    rb: stm32::cordic::CORDIC,
}
```

...but... this doesn't really change anything.

The naive approach to achieving our goal would be adding additional
member attributes to our type that indicate the current configuration.

Something like:

```rust
pub struct Cordic {
    rb: stm32::cordic::CORDIC,
    arg_size: ArgSize,
    res_size: ResSize,
    func: Func,
    // etc...
}
```

The first reason this is not the correct solution is that we increased
our memory footprint for no reason. These states are already present
in the peripheral registers, which we can read at any time.

The second reason this is not the correct solution is that it
unnecessarily *incurs a runtime cost* for usage.

When we put the CORDIC in sine mode, do we need to... check that again?

If anything can reconfigure our resource willy nilly, then, maybe. But we
are trying to **constrain** our resource such that we are the *only*
actors that can mutate it, and **freeze** our resource such that any
binding we have to it represents a fixed configuration.

Let's bring these ideas to life.

The fundamental building block of this design is the use of **type-states**.

Type-states are zero-size-types[^2] which purely exist to represent
states in the type system.

Let's create a trait for each property of the peripheral which
can be configured, and possible type-states of that property
which implement that trait, and incorporate them into our abstraction
as generics:

```rust
pub struct Cordic<Arg, Res, NArgs, NRes, Scale, Prec, Func>
where
    Arg: arg_type::State,
    Res: res_type::State,
    NArgs: nargs::State,
    NRes: nres::State,
    Scale: scale::State,
    Prec: prec::State,
    Func: func::State,
{
    rb: stm32::cordic::CORDIC,
    _arg_size: PhantomData<Arg>,
    _res_size: PhantomData<Res>,
    _nargs: PhantomData<NArgs>,
    _nres: PhantomData<NRes>,
    _scale: PhantomData<Scale>,
    _prec: PhantomData<Prec>,
    _func: PhantomData<Func>,
}
```
> `PhantomData` enables zero-size generics.

That's a lot of states!

These are every configurable property of the peripheral encoded as type-states.

But as we will find out later, many of these are tightly coupled with and/or
dependent on each other and will be absorbed.

Let's define the type which represents the peripheral in its reset state.
> This would be found by reading the reset value in the reference manual.

```rust
pub type CordicReset = Cordic<State1, State2, ..>;
```

Now, let's make an extension trait for `CORDIC` that defines
a new function that consumes the resource and wraps it with our
abstracted type (the **constraining** mentioned earlier):

```rust
pub trait Ext {
    fn constrain(self, rcc: &mut Rcc) -> CordicReset;
}
```
> We assume if the resource is ever *not* enclosed by our abstraction,
> that it is in the reset state.

...and implement it:

```rust
impl Ext for CORDIC {
    fn constrain(self, rcc: &mut Rcc) -> CordicReset {
        rcc.rb.ahb1enr.modify(|_, w| w.cordicen().set_bit());

        // type-states inferred
        Cordic {
            rb: self,
            _state1: PhantomData,
            _state2: PhantomData,
            ..
        }
    }
}
```
> In addition to taking the resource, we borrow the `RCC` to enable the `AHB` lane for the CORDIC.
> This could be deferred to peripheral specific functions like `enable` or `disable` and this state
> could also be encoded as a type-state. For more complex peripherals this may be desirable, but for
> this case I deemed it unnecessary.

Now, let's implement `freeze`. This function represents the transformation from one configuration
to another:

```rust
impl<State1, State2, ..> Cordic<State1, State2, ..>
where
    State1: property1::State,
    State2: property2::State,
    ..
{
    pub fn freeze<NewState1, NewState2, ..>(
        self,
    ) -> Cordic<NewState1, NewState2, ..>
    where
        NewState1: property1::State,
        NewState2: property2::State,
        ..
    {
        self.rb.csr.write(|w| {
            NewState1::set(w);
            NewState2::set(w);
            ..

            w
        });

        Cordic {
            rb: self.rb,
            _state1: PhantomData,
            _state2: PhantomData,
            ..
        }
    }
}
```

Type-state traits should define a function called `set` which
mutates the appropriate register to configure the resource into
the state the type-state represents.

`freeze()` only needs to invoke all state `set`s and then construct a new
abstraction instance with the new type-states to successfully transform
the passed instance.

This process is highly adaptive, as it is independent of the behavior and
relationships of the type-states.

## Creating States
### Data Types

The first type-states we'll implement are the argument and result types:

```rust
pub mod data_type {
    pub struct Q31;
    pub struct Q15;
}
```

And let's make a trait for type-states that have a corresponding
fixed-point type:

```rust
pub mod data_type {
    pub trait DataType {
        type Fixed: Fixed;
    }

    // pub struct Q31;
    // pub struct Q15;
}
```
> I'm using the `fixed` crate for fixed-point types and traits.
> Our associated type `Fixed` requires `fixed::Fixed`.

The implementations are straight forward:

```rust
pub mod data_type {
    // pub trait DataType {
    //     type Fixed: Fixed;
    // }

    // pub struct Q31;
    // pub struct Q15

    impl DataType for Q31 {
        type Fixed = I1F31;
    }

    impl DataType for Q15 {
        type Fixed = I1F15;
    }
}
```

Now let's define the trait that represents argument data types:

```rust
pub mod data_type {
    pub mod arg {
        pub trait State {
            fn set(w: &mut crate::stm32::cordic::csr::W);
        }
    }
}
```

...and implement it for our data types with a small macro:

```rust
pub mod arg {
    // pub trait State {
    //     fn set(w: &mut crate::stm32::cordic::csr::W);
    // }

    macro_rules! impls {
        ( $( ($NAME:ty, $SIZE:ident) $(,)? )+ ) => {
            $(
                impl State for $NAME {
                    fn set(w: &mut crate::stm32::cordic::csr::W) {
                        w.argsize().$SIZE();
                    }
                }
            )+
        };
    }

    impls! {
        (data_type::Q31, bits32),
        (data_type::Q15, bits16),
    }
}
```

We do the axact same thing for result data types but in the
`ressize` bitfield rather than the `argsize` bitfield.

### Precision

We can follow a very similar procedure for precision:

```rust
pub mod prec {
    pub(crate) trait State {
        const BITS: u8;

        fn set(w: &mut crate::stm32::cordic::csr::W);
    }

    pub struct P4;
    pub struct P8;
    ..
    pub struct P56;
    pub struct P60;

    macro_rules! impls {
        ( $( ($NAME:ident, $BITS:expr) $(,)? )+ ) => {
            $(
                impl State for $NAME {
                    const BITS: u8 = $BITS;

                    fn set(w: &mut crate::stm32::cordic::csr::W) {
                        unsafe { w.precision().bits(<Self as State>::BITS) };
                    }
                }
            )+
        };
    }

    impls! {
        (P4, 1),
        (P8, 2),
        ..
        (P56, 14),
        (P60, 15),
    }
}
```

In this case, we were able to leverage associated constants to allow
type-states to specify the value of a bitfield directly.

This operation is `unsafe` because not all bitfield values are valid.

If a foreign type were to implement `State` with `State::BITS` equal to
`0`, and were set, it would result in an invalid peripheral coonfiguration
(probably undefined behavior).

We can curb this eventuality by sealing our `State` traits within the HAL crate
via `pub(crate)`.

### Function

This is where things get... complicated.

I decided function type-states will encode not only which function is being evaluated,
but how many arguments the user wishes to provide (where the second argument will hold
a default value if omitted).

Another tricky thing about function type-states is that their behavior is *dependent* on other type-states
(namely the data types).

Suppose we want to start the atan2 function and provide both the $x$ and $y$ arguments.

If the `Q15` data type is selected, then we write the two arguments into the `WDATA` register.

If the `Q31` data type is selected, we write each argument to the `WDATA` register in succession.

The behavior defined by our function type-state *changed* due to *other type-states*.

Allow me to introduce the next property of type-states...

#### Dependence

The behavior of our function type-states depends on the data type-states. To reflect this,
the function type-state trait should accept two generics:

```rust
mod func {
    pub(crate) trait State<Arg, Res>
    where
        Arg: data_type::arg::State,
        Res: data_type::res::State,
    {
        fn set(w: &mut crate::stm32::cordic::csr::W);
    }
}
```

Wait, but... it *also* depends on the *number* of function arguments/results?

Indeed, however the number of function arguments/results is encoded by the function type itself.

For example, there is a function `Sin`, and a function `SinCos`. Both of these configure the same
function `sine` in the peripheral, but differing number of results to be read.

We can represent these function properties with two new sub-type-states:

```rust
pub mod func {
    pub mod data_count {
        pub struct One;
        pub struct Two;

        pub mod arg {
            pub(crate) trait State {
                fn set(w: &mut crate::stm32::cordic::csr::W);
            }
        }

        pub mod res {
            pub(crate) trait State {
                fn set(w: &mut crate::stm32::cordic::csr::W);
            }
        }
    }

    ..
}
```

...and implement them:

```rust
impl State for One {
    fn set(w: &mut crate::stm32::cordic::csr::W) {
        w.nargs().num1();
    }
}

impl State for Two {
    fn set(w: &mut crate::stm32::cordic::csr::W) {
        w.nargs(). // ?
    }
}
```
> Implementations for results are very similar.

Wait... the behavior of `State::set` for two function arguments is dependent on the
argument type! For `Two`, if the argument type is `Q15`, only one regiester write is needed, but if
the argument type is `Q31` then two register writes are needed.

This means these sub-type-states are also dependent on their respective data type-states.

Let's adjust the traits:

```rust
pub mod func {
    pub mod data_count {
        pub mod arg {
            pub(crate) trait State<Arg>
            where
                Arg: data_type::arg::State,
            {
                fn set(w: &mut crate::stm32::cordic::csr::W);
            }
        }

        pub mod res {
            pub(crate) trait State<Res>
            where
                Res: data_type::res::State,
            {
                fn set(w: &mut crate::stm32::cordic::csr::W);
            }
        }
    }
}
```

...and implement them:

```rust
impl<Arg> State<Arg> for One
where
    Arg: data_type::arg::State,
{
    fn set(w: &mut crate::stm32::cordic::csr::W) {
        w.nargs().num1();
    }
}

impl<Arg> State<Arg> for Two
where
    Arg: data_type::arg::State,
{
    fn set(w: &mut crate::stm32::cordic::csr::W) {
        w.nargs(). // Arg::Something?
    }
}
```

Well we hit another roadblock, how can we derive behavior from the generic type-sates?

Well, this is what associated constants are for! Just like for precision, argument and result
types will define their bitfield value as a `BITS` constant:

```rust
pub mod data_type {
    pub mod arg {
        pub(crate) trait State {
            const BITS: bool;

            fn set(w: &mut crate::stm32::cordic::csr::W);
        }
    }

    pub mod res {
        pub(crate) trait State {
            const BITS: bool;

            fn set(w: &mut crate::stm32::cordic::csr::W);
        }
    }
}
```

...and now:

```rust
impl<Arg> State<Arg> for One
where
    Arg: data_type::arg::State,
{
    fn set(w: &mut crate::stm32::cordic::csr::W) {
        w.nargs().num1();
    }
}

impl<Arg> State<Arg> for Two
where
    Arg: data_type::arg::State,
{
    fn set(w: &mut crate::stm32::cordic::csr::W) {
        w.nargs().bit(!Arg::BITS);
    }
}
```
> This looks the same for results but on the `nres` bitfield.

Now we can write out our function trait with the type-state dependencies and sub-type-states:

```rust
pub mod func {
    pub(crate) trait State<Arg, Res>
    where
        Arg: data_type::arg::State,
        Res: data_type::res::State,
    {
        type NArgs: data_count::arg::State<Arg>;
        type NRes: data_count::res::State<Res>;

        fn set(w: &mut crate::stm32::cordic::csr::W);
    }
}
```

Let's define our function type-states:

```rust
pub mod func {
    pub struct Cos;
    pub struct Sin;
    pub struct SinCos;
    pub struct CosM;
    pub struct SinM;
    pub struct SinCosM;
    pub struct ATan2;
    pub struct Magnitude;
    pub struct ATan2Magnitude;
    pub struct ATan; // ?
    pub struct CosH;
    pub struct SinH;
    pub struct SinHCosH;
    pub struct ATanH;
    pub struct Ln; // ?
    pub struct Sqrt; // ?
}
```

Each of these type-states represents not only each function, but the permutations of each function
and possible number of arguments and results.

What's up with the `?`s, though?

Well, these functions have variable scale factors that can be configured. (Remember [SCALE](#scale))

![](https://cdn.adinack.dev/better-hals-first-look/arctangent-params.png)

Rather than defining each scale factor concretely:

```rust
pub struct ATanScale0;
pub struct ATanScale1;
pub struct ATanScale2;
..
```

We can add a generic constraint:

```rust
pub struct ATan<Scale: scale::State> {
    _scale: PhantomData<Scale>,
}
```
> I'm skipping the process of creating the `scale` type-states, we've seen that many times already.

Now let's try implementing the function trait:

```rust
impl<Arg, Res, Scale> State<Arg, Res> for Atan<Scale>
where
    Arg: data_type::arg::State,
    Res: data_type::res::State,
    Scale: scale::State,
{
    type NArgs = data_count::One;
    type NRes = data_count::One;

    fn set(w: &mut crate::stm32::cordic::csr::W) {
        // set our sub-type-states' configuration
        <Self::NArgs as data_count::arg::State<Arg>>::set(w);
        <Self::NRes as data_count::res::State<Res>>::set(w);

        // set our own configuration
        <Scale as scale::State>::set(w);
        w.func().arctangent();
    }
}
```

Unfortunately, it is not so simple for the other scalable functions.

We were lucky that `ATan` works across the entire range of scale values,
but `Ln` and `Sqrt` do not.

This means for those functions, we cannot write a generic impl across all
scales. We need to concretely impl them for only valid scales.

Here are the signatures for the two declarative macros that accomplish this:

```rust
impls! {
    (Cos<scale::N0>, cosine, One, One, start(angle)),
    (Sin<scale::N0>, sine, One, One, start(angle)),
    (SinCos<scale::N0>, sine, One, Two, start(angle)),
    (CosM<scale::N0>, cosine, Two, One, start(angle, modulus)),
    (SinM<scale::N0>, sine, Two, One, start(angle, modulus)),
    (SinCosM<scale::N0>, sine, Two, Two, start(angle, modulus)),
    (ATan2<scale::N0>, phase, Two, One, start(x, y)),
    (Magnitude<scale::N0>, modulus, Two, One, start(x, y)),
    (ATan2Magnitude<scale::N0>, phase, Two, Two, start(x, y)),
    (CosH<scale::N1>, hyperbolic_cosine, One, One, start(x)),
    (SinH<scale::N1>, hyperbolic_sine, One, One, start(x)),
    (SinHCosH<scale::N1>, hyperbolic_cosine, One, Two, start(x)),
    (ATanH<scale::N1>, arctanh, One, One, start(x)),
}

impls_multi_scale! {
    (ATan<scale::N0, scale::N1, scale::N2, scale::N3, scale::N4, scale::N5, scale::N6, scale::N7>, arctangent, One, One, start(x)),
    (Ln<scale::N1, scale::N2, scale::N3, scale::N4>, natural_logarithm, One, One, start(x)),
    (Sqrt<scale::N0, scale::N1, scale::N2>, square_root, One, One, start(x)),
}
```
> These macros are rather large, and the details of their operation are not important.

#### Compile-time Validation

Now, if one were to try and set `Sqrt` with a scale of `N3`, the following error
message would appear:

```txt
error[E0277]: the trait bound `Sqrt<N3>: func::State<Qxx, Qxx>` is not satisfied
   --> src/main.rs
    |
    |         let mut cordic = ctx.device.CORDIC.constrain(&mut rcc).freeze();
    |                                                                ^^^^^^ the trait `func::State<Qxx, Qxx>` is not implemented for `Sqrt<N3>`
    |
    = help: the following other types implement trait `func::State<Arg, Res>`:
              Sqrt<N0>
              Sqrt<N1>
              Sqrt<N2>
```
> Slightly modified to demonstrate generalized behavior.

The moment we try to apply an invalid configuration to the peripheral with `freeze()` the compiler stops us!

Moreover, it happily suggests some alternative *valid* configurations.

We have coerced the compiler into recognizing and enforcing *hardware invariances*.

**\>\>\> [All HALs should do this] \<\<\<**

---

The next function the impl macros perform is implementing the `start(..)` and `result()` methods.

Every permutation of function, argument, result, narg, and nres type-states influence the
signature and behavior of these methods.

For example, `Atan` with `Q15` arguments and results:

```rust
pub fn start(
    &mut self,
    x: <data_type::Q15 as data_type::DataType>::Fixed,
    y: <data_type::Q15 as data_type::DataType>::Fixed
) {
    // $RM0440 17.4.2
    let reg = (x.to_bits() as u16 as u32) | ((y.to_bits() as u16 as u32) << 16);

    self.rb.wdata.write(|w| w.arg().bits(reg));
}

pub fn result(&mut self) -> <data_type::Q15 as data_type::DataType>::Fixed {
    <data_type::Q15 as data_type::DataType>::Fixed::from_bits(
        self.rb.rdata.read().res().bits() as _,
    )
}
```

`SinCos` with `Q31` arguments and results:

```rust
pub fn start(&mut self, angle: <data_type::Q31 as data_type::DataType>::Fixed) {
    self.rb
        .wdata
        .write(|w| w.arg().bits(angle.to_bits() as _));
}

pub fn result(
    &mut self,
) -> (
    <data_type::Q31 as data_type::DataType>::Fixed,
    <data_type::Q31 as data_type::DataType>::Fixed,
) {
    (
        <data_type::Q31 as data_type::DataType>::Fixed::from_bits(self.rb.rdata.read().res().bits() as _),
        <data_type::Q31 as data_type::DataType>::Fixed::from_bits(self.rb.rdata.read().res().bits() as _),
    )
}
```

Not only do the signatures completely change, but the operations involved are completely different as well.

To generate the proper functions, the impl macros split implementations into four groups:

1. start: one arg
1. start: two args
1. result: one res
1. result: two res

Each group will implement for both `Q31` and `Q15` for a total of eight implementation branches.

The macros have multiple token patterns so they can be dispatched recursively:

```rust
macro_rules! impls {
    // root / config
    ( $( ($NAME:ident < $SCALE:ty >, $FUNC:ident, $NARGS:ident, $NRES:ident, start( $($START_PARAM:ident),+ )) $(,)?)+ ) => {
        $(
            impl<Arg, Res> State<Arg, Res> for $NAME
            where
                Arg: data_type::arg::State,
                Res: data_type::res::State,
            {
                type NArgs = data_count::$NARGS;
                type NRes = data_count::$NRES;

                fn set(w: &mut crate::stm32::cordic::csr::W) {
                    <Self::NArgs as data_count::arg::State<Arg>>::set(w);
                    <Self::NRes as data_count::res::State<Res>>::set(w);
                    <$SCALE as scale::State>::set(w);
                    w.func().$FUNC();
                }
            }

            impls!($NAME, $NARGS, start( $($START_PARAM),+ ));
            impls!($NAME, $NRES);
        )+
    };

    // impl start for one arg
    ($NAME:ty, One, start( $PRIMARY:ident )) => { .. };

    // impl start for two args
    ($NAME:ty, Two, start( $PRIMARY:ident, $SECONDARY:ident )) => { .. };

    // impl result for one result
    ($NAME:ty, One) => { .. };

    // impl result for two results
    ($NAME:ty, Two) => { .. };
}
```
> `impls_multi_scale` is very similar to `impls`.

## Common Interfaces

And that does it for type-states! Now we can implement some general functionality.

I wanted to use `proto-hal` to define HAL related traits or structures that all resource
abstractions should implement where applicable.

Let's implement some of them for CORDIC.

### Reset

The first `proto-hal` trait:

```rust
pub trait IntoReset {
    type Reset;

    fn into_reset(self) -> Self::Reset;
}
```

...let's implement it :

```rust
/// $RM0440 17.4.1
pub type CordicReset = Cordic<data_type::Q31, data_type::Q31, func::Cos, prec::P20>;

impl<Arg, Res, Func, Prec> proto::IntoReset for Cordic<Arg, Res, Func, Prec>
where
    Arg: data_type::arg::State,
    Res: data_type::res::State,
    Func: func::State<Arg, Res>,
    Prec: prec::State,
{
    type Reset = CordicReset;

    fn into_reset(self) -> Self::Reset {
        self.freeze()
    }
}
```

Easy enough!

### Listen

Unfortunately, this concept cannot be a trait becuase the signature of the associated
methods are application dependent.

The general idea is that `listen()` can be called to enable interrupts for a peripheral.

We can implement it concretely:

```rust
impl<Arg, Res, Func, Prec> Cordic<Arg, Res, Func, Prec>
where
    Arg: data_type::arg::State,
    Res: data_type::res::State,
    Func: func::State<Arg, Res>,
    Prec: prec::State,
{
    pub fn listen(&mut self) {
        self.rb.csr.modify(|_, w| w.ien().set_bit());
    }

    pub fn unlisten(&mut self) {
        self.rb.csr.modify(|_, w| w.ien().clear_bit());
    }
}
```

More complex peripherals may require an `Events` enum to be passed to specify
*which* events to listen for, or may require other resource bindings to fascilitate
the interrupt enable.

### Release

It is conceivable that we may want to, at times, *unconstrain* the resource back to its
raw form. This could be useful for recombining split[^3] resources to reconfigure the
umbrella resource to be resplit.

```rust
impl<Arg, Res, Func, Prec> Cordic<Arg, Res, Func, Prec>
where
    Arg: data_type::arg::State,
    Res: data_type::res::State,
    Func: func::State<Arg, Res>,
    Prec: prec::State,
{
    pub unsafe fn release(self) -> CORDIC {
        self.rb
    }

    pub fn release_and_reset(self, rcc: &mut Rcc) -> CORDIC {
        let reset: CordicReset = self.freeze();

        rcc.rb.ahb1enr.modify(|_, w| w.cordicen().clear_bit());

        unsafe { reset.release() }
    }
}
```

The simplest operation (just extracting the resource and throwing away the abstraction)
is `unsafe` because an assumption we made earlier was that any unwrapped resource shall
be in a reset state. Additionally, since this is hardware we are dealing with, it could
continue operating and interacting with other resources even though it is no longer
represented in our program.

The second method permits the safe reset and release of the resource.

Due to the variable method signatures, this concept can also not be enforced by a trait.

## Usage

Let's see all our hard work in action!

```rust
#[rtic::app(device = hal::stm32, peripherals = true)]
mod app {
    type TestCordic = cordic::Cordic<
        cordic::data_type::Q15,
        cordic::data_type::Q31,
        cordic::func::SinCos,
        cordic::prec::P60,
    >;

    #[shared]
    struct Shared {
        cordic: TestCordic,
    }

    #[local]
    struct Local {}

    #[init]
    fn init(ctx: init::Context) -> (Shared, Local) {
        // config clocks, monotonic, etc...

        let mut cordic = ctx.device.CORDIC.constrain(&mut rcc).freeze();
        cordic.listen();

        fmt::unwrap!(push_cordic::spawn());

        (Shared { cordic }, Local {})
    }

    #[task(shared = [cordic])]
    async fn push_cordic(mut ctx: push_cordic::Context) {
        let mut angle = I1F15::MIN;

        loop {
            fmt::info!("angle: {}rad", angle.to_num::<f32>() * 3.14);

            ctx.shared.cordic.lock(|cordic| cordic.start(angle));

            angle = angle.wrapping_add(I1F15::from_bits(0x100));

            Mono::delay(1u64.secs()).await;
        }
    }

    #[task(binds = CORDIC, shared = [cordic])]
    fn cordic_result(mut ctx: cordic_result::Context) {
        let (sin, cos) = ctx.shared.cordic.lock(|cordic| cordic.result());

        fmt::info!("sin: {}, cos: {}", sin.to_num::<f32>(), cos.to_num::<f32>());
    }
}
```

Here is a small RTIC application to test out our interface.

It simply initializes the CORDIC configured in `SinCos` mode and listens for events.

It spawns a software task that writes angles to the CORDIC in a loop.

It also defines a hardware task bound to the `CORDIC` interrupt vector and reads the results.

Some output:

```txt
INFO  angle: -3.14rad
└─ cordic_test::app::push_cordic::{async_fn#0}
INFO  sin: -5.9604645e-7, cos: -0.9999695
└─ cordic_test::app::cordic_result
INFO  angle: -3.1154687rad
└─ cordic_test::app::push_cordic::{async_fn#0}
INFO  sin: -0.024540424, cos: -0.99966824
└─ cordic_test::app::cordic_result
INFO  angle: -3.0909376rad
└─ cordic_test::app::push_cordic::{async_fn#0}
INFO  sin: -0.049066067, cos: -0.99876475
└─ cordic_test::app::cordic_result @ src/fmt.rs:131
```

Look at that! Works great :)

## Performance

Ok so it works, and the interface is robust and easy to use, but how does
the resulting binary compare to doing it by hand?

Here is the code for configuring the CORDIC manually:

```rust
#[no_mangle]
#[inline(never)]
fn cordic_init(rb: hal::stm32::CORDIC) -> TestCordic {
    unsafe {
        (*hal::stm32::RCC::ptr())
            .ahb1enr
            .modify(|_, w| w.cordicen().set_bit())
    };

    rb.csr.modify(|_, w| {
        w.argsize().bits16();
        w.ressize().bits32();
        w.nargs().num1();
        w.nres().num2();
        w.func().sine();
        w.scale().bits(0);
        unsafe { w.precision().bits(15) }
    });
}
```

...and the resulting assembly:

```asm
08000404 <cordic_init>:
 8000404: f640 4000    	movw	r0, #0xc00
 8000408: f64f 0200    	movw	r2, #0xf800
 800040c: f2c4 0002    	movt	r0, #0x4002
 8000410: f6cf 7287    	movt	r2, #0xff87
 8000414: f8d0 1448    	ldr.w	r1, [r0, #0x448]
 8000418: f041 0108    	orr	r1, r1, #0x8
 800041c: f8c0 1448    	str.w	r1, [r0, #0x448]
 8000420: 6801         	ldr	r1, [r0]
 8000422: 4011         	ands	r1, r2
 8000424: f441 0190    	orr	r1, r1, #0x480000
 8000428: f041 01f1    	orr	r1, r1, #0xf1
 800042c: 6001         	str	r1, [r0]
 800042e: 4770         	bx	lr
```

Now with the abstraction:

```rust
#[no_mangle]
#[inline(never)]
fn cordic_init(rb: hal::stm32::CORDIC, rcc: &mut rcc::Rcc) -> TestCordic {
    rb.contrains(rcc).freeze()
}
```

...and the resulting assembly:

```asm
08000404 <cordic_init>:
 8000404: f241 0048    	movw	r0, #0x1048
 8000408: 22f1         	movs	r2, #0xf1
 800040a: f2c4 0002    	movt	r0, #0x4002
 800040e: f2c0 0248    	movt	r2, #0x48
 8000412: 6801         	ldr	r1, [r0]
 8000414: f041 0108    	orr	r1, r1, #0x8
 8000418: 6001         	str	r1, [r0]
 800041a: f64f 31b8    	movw	r1, #0xfbb8
 800041e: f6cf 71ff    	movt	r1, #0xffff
 8000422: 5042         	str	r2, [r0, r1]
 8000424: 4770         	bx	lr
```
> It's cool to see how our type-state combinations are baked as immediate values
in the assembly.

Are my eyes deceiving me? It's shorter??

To be honest, I don't know why this is. Both of these set `CSR` to the same value:

```txt
CSR: 00000000010010010000000011110001
```

So... I made a *negative*-cost abstraction? Or perhaps somehow the type information
provides the compiler with enough context to architect the resulting binary more efficiently.
Or maybe we are tickling different regions of the compiler which have different strategies for
generating the binary.

This will remain a mystery, for now...

## Conclusion

Nonetheless, clearly the abstraction is highly performant and does not incur any
runtime cost, while providing a robust interface with compile-time validation.

You may have noticed that I *did not* touch the DMA capability of the CORDIC
peripheral, and did not include it in the abstraction. This is because I have not
finalized my ideas for standardizing DMA interaction with resource interfaces.
I do plan to comprehensively discuss this topic and my design choices for a future
HAL implementation for the ADC.

[^1]: SVD files describe the layout of a microcontroller and are provided by the manufacturer.
Rust PACs are generated from these files.
[^2]: **Z**ero-**S**ize-**T**ypes (ZSTs) do not exist in memory as they have a size of 0. The compiler
can use this knowledge to conduct inductive reasoning and determine flow statically and with zero overhead.
[^3]: Another HAL prototype design, the concept of splitting a resource into components that can be
controlled and configured individually.
