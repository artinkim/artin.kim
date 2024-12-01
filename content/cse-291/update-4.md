+++
title = "CSE 291 Project Update 4"
date = 2024-12-01
draft = false
unlisted = true
+++

This week's efforts were directed towards refactoring the
peripheral description model, implementing more static
analysis functionality, and generating usable interfaces.

## Refactor

Rather than using `struct`s and `enum`s to describe
blocks, registers, fields, and states, all components
of a peripheral are *modules*.

In the previous setup peripheral components ended up
as modules anyway, but this expansion was not clear to the user.

Now, describing peripherals is simple and expressive:

```rust
#[block(
    base_addr = 0x4002_1000,
    auto_increment,
    entitlements = [super::ahb::cordic_en::Enabled]
)]
mod cordic {
    #[register(auto_increment)]
    mod csr {
        #[field(width = 4, read, write, auto_increment)]
        mod func {
            #[state(entitlements = [scale::N0], reset)]
            struct Cos;

            #[state(entitlements = [scale::N0])]
            struct Sin;

            #[state(entitlements = [scale::N0])]
            struct ATan2;

            #[state(entitlements = [scale::N0])]
            struct Magnitude;

            #[state]
            struct ATan;

            #[state(entitlements = [scale::N1])]
            struct CosH;

            #[state(entitlements = [scale::N1])]
            struct SinH;

            #[state(entitlements = [scale::N1])]
            struct ATanH;

            #[state(entitlements = [scale::N1, scale::N2, scale::N3, scale::N4])]
            struct Ln;

            #[state(entitlements = [scale::N0, scale::N1, scale::N2])]
            struct Sqrt;
        }

        #[field(width = 4, read, write, auto_increment)]
        mod precision {
            #[state(bits = 1)]
            struct P4;
            #[state]
            struct P8;
            #[state]
            struct P12;
            #[state]
            struct P16;
            #[state(reset)]
            struct P20;
            #[state]
            struct P24;
            #[state]
            struct P28;
            #[state]
            struct P32;
            #[state]
            struct P36;
            #[state]
            struct P40;
            #[state]
            struct P44;
            #[state]
            struct P48;
            #[state]
            struct P52;
            #[state]
            struct P56;
            #[state]
            struct P60;
        }

        #[field(width = 3, read, write, auto_increment)]
        mod scale {
            #[state(reset)]
            struct N0;
            #[state]
            struct N1;
            #[state]
            struct N2;
            #[state]
            struct N3;
            #[state]
            struct N4;
            #[state]
            struct N5;
            #[state]
            struct N6;
            #[state]
            struct N7;
        }

        #[field(offset = 16, width = 1, read, write)]
        mod ien {
            #[state(reset, bits = 0)]
            struct Disabled;
            #[state(bits = 1)]
            struct Enabled;
        }

        #[field(width = 1, read, write)]
        mod dmaren {
            #[state(reset, bits = 0)]
            struct Disabled;
            #[state(bits = 1)]
            struct Enabled;
        }

        #[field(width = 1, read, write)]
        mod dmwren {
            #[state(reset, bits = 0)]
            struct Disabled;
            #[state(bits = 1)]
            struct Enabled;
        }

        #[field(width = 1, read, write)]
        mod nres {
            #[state(reset, bits = 0)]
            struct OneRead;
            #[state(bits = 1, entitlements = [ressize::Q31])]
            struct TwoReads;
        }

        #[field(width = 1, read, write)]
        mod nargs {
            #[state(reset, bits = 0)]
            struct OneWrite;
            #[state(bits = 1, entitlements = [argsize::Q31])]
            struct TwoWrites;
        }

        #[field(width = 1, read, write)]
        mod ressize {
            #[state(reset, bits = 0)]
            struct Q31;
            #[state(bits = 1)]
            struct Q15;
        }

        #[field(width = 1, read, write)]
        mod argsize {
            #[state(reset, bits = 0)]
            struct Q31;
            #[state(bits = 1)]
            struct Q15;
        }

        #[field(offset = 31, width = 1, read)]
        mod rrdy {
            #[state(reset, bits = 0)]
            struct NoData;
            #[state(bits = 1)]
            struct DataReady;
        }
    }

    #[register]
    mod wdata {
        #[field(offset = 0, width = 32, write(effect = unresolve(csr::rrdy)))]
        mod arg {}
    }

    #[register]
    mod rdata {
        #[field(offset = 0, width = 32, reset = 0, read(entitlements = [csr::rrdy::Ready], effect = unresolve(csr::rrdy)))]
        mod res {}
    }
}
```
> An actual functional in real life description of the G4 CORDIC peripheral
> which generates appropriate peripheral interfaces.

## Static Analysis

In addition to analyzing field domains, we now analyze state domains.

States must directly correspond to a unique value of a field, and the
value must fit within the width of the field.

These two constraints are validated at compile-time:

![](https://cdn.adinack.dev/cse-291/field-width-error.png)
> The width was accidentally set to `3` by the developer
> but the enumerated states could not fit in only 3 bits.

## Usage

Let's try to use the CORDIC peripheral.

The cordic peripheral struct looks like this:

```rust
pub struct Block<Csr> {
    pub csr: Csr,
    pub wdata: wdata::Register,
    pub rdata: rdata::Register,
}
```
> This is actual code generated by the macro.

*Why is `csr` the only generic register?*

*Why would a register be generic at all?*

Our goal is for peripheral types to encode their state.

In this case, the state of the cordic is only dependent
on the state of the `csr` register.

In other words, `wdata` and `rdata` are **stateless**, while
`csr` is **stateful**.

This makes sense because `csr` is a configuration register,
while `wdata` and `rdata` are purely for writing and reading
values respectively.

**The state of the cordic is not a function of the value
of `wdata` or `rdata`.**

How did the developer state this?

Well, they didn't. The procedural macro resolved the statefulness
of these registers based on how they were described.

Look at the descriptions of `wdata` and `rdata`:

```rust
#[register]
mod wdata {
    #[field(offset = 0, width = 32, write(effect = unresolve(csr::rrdy)))]
    mod arg {}
}

#[register]
mod rdata {
    #[field(offset = 0, width = 32, reset = 0, read(entitlements = [csr::rrdy::Ready], effect = unresolve(csr::rrdy)))]
    mod res {}
}
```

There are no states defined, so these registers must be stateless.

Let's look at the definition for the `csr` register:

```rust
pub struct Register<
    Func,
    Precision,
    Scale,
    Ien,
    Dmaren,
    Dmwren,
    Nres,
    Nargs,
    Ressize,
    Argsize,
    Rrdy,
> {
    pub func: Func,
    pub precision: Precision,
    pub scale: Scale,
    pub ien: Ien,
    pub dmaren: Dmaren,
    pub dmwren: Dmwren,
    pub nres: Nres,
    pub nargs: Nargs,
    pub ressize: Ressize,
    pub argsize: Argsize,
    pub rrdy: Rrdy,
}
```
> This is actual code generated by the macro.

Similarly to the block struct, the generics of the register
struct correspond to every stateful *field*.

Let's try to do something with these structures.

---

Usually, the resource manager (Embassy, RTIC, raw PAC) would
provide a `Peripherals` struct with all peripherals in reset
state, but that system hasn't been setup yet, so we will conjure
the CORDIC peripheral from nothing for testing purposes.

```rust
let p: cordic::Reset = unsafe { core::mem::transmute(()) };
```

The `Reset` of `cordic` is recursively generated as the reset
of all children.

All **readable** fields must have a reset specified,
and all stateful fields must be readable, so stateful
registers necessarily have a reset state, and blocks
of stateful registers necessarily have a reset state.

But we don't want the cordic to be in its reset state,
let's change the state!

To access a register for transitioning, we use the
corresponding register accessor:

```rust
let p = p.csr(|reg| {
    todo!()
});
```

Hovering over `reg` reveals the enumerated state
of the register:

![](https://cdn.adinack.dev/cse-291/reg-state.png)
> Also note the register is a ZST, good!

To change the state, we need to build a transition.

For this, we use a `TransitionBuilder` to track the
generics as they are set and then resolve them
into a new register with the built state:

```rust
let p = p.csr(|reg| {
    use cordic::csr::*;

    reg.build_transition()
        .argsize::<argsize::Q15>()
        .nargs::<nargs::TwoWrites>()
        .func::<func::Sin>()
        .precision::<precision::P60>()
        .finish()
});
```
> This configuration is {{< special "invalid" >}} because the
> entitlement of `nargs` is not satisfied.
> Entitlement and effect enforcement is next to be impplemented.

And now our peripheral is in the state we desired.

We can write to the argument register, and read from the result register:

```rust
p.wdata.write(|w| w.arg(0x7000));
// p.wdata.read(|r| r.arg()); // does not compile because `arg` is not readable
let result = p.rdata.read(|r| r.res());
// p.rdata.write(|w| w.res(0x7000)); // does not compile because `res` is not writable
```
> Once again, there are omitted entitlement and effect constraints
> because that is yet to be implemented.

Very nice.

I forgot my testbenches at school so I cannot run integration tests.

## In the Weeds

How was this code generated? How does the `TransitionBuilder` work?
How is access gated? How does the transition actually influence hardware?

Let's go one by one.

### How was this code generated?

The procedural macro ingests the contents of the peripheral, register, and field
modules and the passed annotation arguments to make decisions about the
resulting interface structure.

*A field has no states?* Must be stateless.

*A register has at least one stateful field?* Must be stateful.

*A register is stateful?* Must have a reset value which is derived
from the stateful fields.

Simple reasoning like that is conducted.

Much of the codegen is simple linear and opt-in/out generation.

### How does the `TransitionBuilder` work?

The `TransitionBuilder` is a ZST which purely maintains register state
in an unusable fashion.

When I say *unusable* I mean that the states it holds cannot be used for
anything until they are in a register struct.

The `TransitionBuilder` is purely for building... transitions.

If we look at the expanded `TransitionBuilder` for `csr`:

```rust
pub struct TransitionBuilder<
    Func,
    Precision,
    Scale,
    Ien,
    Dmaren,
    Dmwren,
    Nres,
    Nargs,
    Ressize,
    Argsize,
    Rrdy,
> {
    pub func: core::marker::PhantomData<Func>,
    pub precision: core::marker::PhantomData<Precision>,
    pub scale: core::marker::PhantomData<Scale>,
    pub ien: core::marker::PhantomData<Ien>,
    pub dmaren: core::marker::PhantomData<Dmaren>,
    pub dmwren: core::marker::PhantomData<Dmwren>,
    pub nres: core::marker::PhantomData<Nres>,
    pub nargs: core::marker::PhantomData<Nargs>,
    pub ressize: core::marker::PhantomData<Ressize>,
    pub argsize: core::marker::PhantomData<Argsize>,
    pub rrdy: core::marker::PhantomData<Rrdy>,
}
```
> This is actual code generated by the macro.

It looks a lot like the register struct, but the `impl`
blocks are where things get interesting.

```rust
impl<Func, Precision, Scale, Ien, Dmaren, Dmwren, Nres, Nargs, Ressize, Argsize, Rrdy>
    TransitionBuilder<
        Func,
        Precision,
        Scale,
        Ien,
        Dmaren,
        Dmwren,
        Nres,
        Nargs,
        Ressize,
        Argsize,
        Rrdy,
    >
where
    Func: func::State,
    Precision: precision::State,
    Scale: scale::State,
    Ien: ien::State,
    Dmaren: dmaren::State,
    Dmwren: dmwren::State,
    Nres: nres::State,
    Nargs: nargs::State,
    Ressize: ressize::State,
    Argsize: argsize::State,
    Rrdy: rrdy::State,
{
    pub fn func<S>(
        self,
    ) -> TransitionBuilder<
        S,
        Precision,
        Scale,
        Ien,
        Dmaren,
        Dmwren,
        Nres,
        Nargs,
        Ressize,
        Argsize,
        Rrdy,
    >
    where
        S: func::State,
    {
        unsafe { TransitionBuilder::conjure() }
    }
}
```
> This is actual code generated by the macro.

This is the definition of the `.func()` method
we used to change the function from `Cos` (reset)
to `Sin`.

As you can see the function body does nothing,
it's the *signature* which is important.

The signature says that all generics remain
the same *except* for the function generic.

If we look at the `.precision()` signature:

```rust
pub fn precision<S>(
    self,
) -> TransitionBuilder<
    Func,
    S,
    Scale,
    Ien,
    Dmaren,
    Dmwren,
    Nres,
    Nargs,
    Ressize,
    Argsize,
    Rrdy,
>
where
    S: precision::State;
```

You'll see the `S` (the mutated state) is now
in the second position, corresponding to the
precision state.

Finishing a transition means taking the established
states and conjuring a register struct of that state.

**Importantly**, we only create that register instance
once it correctly reflects hardware, which is achieved
with a volatile write to the appropriate address:

```rust
pub fn finish(
    self,
) -> Register<
    Func,
    Precision,
    Scale,
    Ien,
    Dmaren,
    Dmwren,
    Nres,
    Nargs,
    Ressize,
    Argsize,
    Rrdy,
> {
    let reg_value = ((Func::RAW as u32) << func::OFFSET)
        | ((Precision::RAW as u32) << precision::OFFSET)
        | ((Scale::RAW as u32) << scale::OFFSET)
        | ((Ien::RAW as u32) << ien::OFFSET)
        | ((Dmaren::RAW as u32) << dmaren::OFFSET)
        | ((Dmwren::RAW as u32) << dmwren::OFFSET)
        | ((Nres::RAW as u32) << nres::OFFSET)
        | ((Nargs::RAW as u32) << nargs::OFFSET)
        | ((Ressize::RAW as u32) << ressize::OFFSET)
        | ((Argsize::RAW as u32) << argsize::OFFSET);
    unsafe {
        core::ptr::write_volatile((super::BASE_ADDR + OFFSET) as *mut u32, reg_value);
    }
    Register {
        func: unsafe { Func::conjure() },
        precision: unsafe { Precision::conjure() },
        scale: unsafe { Scale::conjure() },
        ien: unsafe { Ien::conjure() },
        dmaren: unsafe { Dmaren::conjure() },
        dmwren: unsafe { Dmwren::conjure() },
        nres: unsafe { Nres::conjure() },
        nargs: unsafe { Nargs::conjure() },
        ressize: unsafe { Ressize::conjure() },
        argsize: unsafe { Argsize::conjure() },
        rrdy: unsafe { Rrdy::conjure() },
    }
}
```
> This is actual code generated by the macro.
>
> Notice that `rrdy` is not present in the computation
> of `reg_value` because it is not writable.

---

The answers to the last two questions are probably clear by now.

Access is gated by simply *not* implementing methods
for structures that don't support them.

Hardware is influenced upon transition completion
via a volatile write.

## Next Up

All that's left is adding entitlement and effect constraints
to the logic and reasoning of the macro. This will also change
many signatures in the resulting interface.

Additionally, generated documentation content can be improved,
a peripheral dispatch struct must be created, and integration
with RTIC is desired.
