+++
title = "CSE 291 Project Update 2"
date = 2024-11-16
draft = false
unlisted = true
+++

This week's efforts were directed towards implementing the new
peripheral access generation system.

## Theory

Part of this process was working on the theory behind designing
state machines with the Rust type system in general, and how
to best represent hardware.

### Fields and Registers and Blocks, Oh My!

As discussed before, blocks contain registers which contain fields.

Additionally, fields *inhabit* states. The enum written for a field's
value outlines the state-space that field traverses via **transitions**.

The state of a register is the sum of the states of its fields.

The state of a block is the sum of the states of its registers.

States can be **entitled** to other states.

Operations can be **entitled** to other states.

Operations can **effect** other states.

These properties can be expressed like so:

```rust
#[register(infer_offsets)]
pub struct Csr {
    #[field(read, write, reset = Cos)]
    func: Func,
    #[field(read, write, reset = P20)]
    precision: Precision,
    #[field(read, write, reset = N0)]
    scale: Scale,

    #[field(offset = 0x10, reset = Disabled)]
    ien: Enable,
    #[field(read, write, reset = Disabled)]
    dmaren: Enable,
    #[field(read, write, reset = Disabled)]
    dmawen: Enable,
    #[field(read, write, reset = One)]
    nres: NData,
    #[field(read, write, reset = One)]
    nargs: NData,
    #[field(read, write, reset = Q15)]
    ressize: DataSize,
    #[field(read, write, reset = Q15)]
    argsize: DataSize,

    #[field(offset = 0x1f, read, reset = NoData)]
    rrdy: Rrdy,
}

#[register(infer_offsets)]
pub struct WData {
    #[field(write(effect = unresolve(csr::rrdy)))]
    arg: u32,
}

#[register(infer_offsets)]
pub struct RData {
    #[field(
        read(
            entitlements = [csr::rrdy::Ready],
            effect = unresolve(csr::rrdy)
        )
    )]
    res: u32,
}

#[block(
    base_addr = 0x4002_1000,
    infer_offsets,
    entitlements = [super::ahb::cordic_en::Enabled]
)]
pub struct Cordic {
    csr: Csr,
    wdata: WData,
    rdata: RData,
}
```
> Peripheral description for CORDIC.
> State definitions omitted.

There are some interesting relationships expressed by this code snippet.

For example, `csr::rrdy` can be **unresolved** by a write to the `wdata::arg`
field. This means that the state of the `csr::rrdy` field is no longer known.

But `rdata::res` requires `csr::rrdy` to be `Ready`, so the user must
**resolve** `csr::rrdy`. This can be achieved by writing to or reading from a
**stateful** field.

Seeing as entitlements refer to a state, the field providing that state must be
stateful.

If the developer listed `csr::rrdy` as an entitlement but it wasn't stateful,
our system would emit compile errors and explain why their peripheral description
is invalid.

### Statefulness

We just used the word **stateful** a lot, but what does it mean?

A field is stateful if it can maintain a state of the peripheral deterministically.

Fields in configuration registers are the simplest example of a stateful field.

In the case of CORDIC, the selected function, precision, scale, are all very obviously
stateful fields.

`csr::rrdy` is also a stateful field, even though we can't write to it. It indicates
whether data is ready to be read or not. The state is resolvable via `read`ing the
field value.

Fields which aren't `read`able but are `write`able can have their state resolved by
writing to the field or via an external resolution effect.

`wdata::arg` is **not** stateful because it's value does not influence the behavior
of the peripheral. *Writing* to this register certainly influences the state, but
that is already encapsulated by `csr::rrdy`. And *which* value is written is
inconsequential.

For stateful fields, the *value* of the field directly corresponds to the state it
is inhabiting.

So `wdata::arg` is not stateful. For the same reasons, `rdata::res` isn't stateful
either.

---

To put it formally:

A field is stateful if its value indicates a peripheral state.

Stateful fields must be resolvable.

Stateful fields must have a reset state.

---

Some nice guardrails emerge from these definitions.

When declaring entitlements, the developer refers to states. These states
necessarily belong to a stateful field, so that invariant is upheld.

If the developer forgets to provide a reset state for a field,
that field will not be considered stateful. This could be fine,
but the moment the developer tries to use that field in a
context which requires it to be stateful, our system will
forbid it. Mistakes like this are easy to make and immediately destroy
system invariances. Eliminating them entirely is a
huge win for developing safety-critical systems.

## Macros

Developing robust and expressive procedural macros is no small feat.

We have put a lot of time and effort into making the control flow of our
procedural macros as readable and modular as possible.

### Structured Parsing

Using the `darling` crate, nested attribute meta arguments are collected
into structs declaratively:

```rust
#[derive(Debug, Default, FromMeta)]
#[darling(default)]
struct Access {
    entitlements: PathArray,
    effect: Option<Meta>,
}
```
> Struct representing field access, i.e. `read`, `write(entitlements = [..])`.

```rust
#[derive(Debug, Default, FromMeta)]
struct FieldArgs {
    offset: Option<u8>,
    read: Option<Access>,
    write: Option<Access>,
    reset: Option<Ident>,
}
```
> Struct representing arguments of the `#[field(..)]` attribute.

### Expressive Errors

With these structs, helpful spanned errors can be emitted:

![](https://cdn.adinack.dev/cse-291/darling_error.png)

Additionally, when constant assertions are emitted for static analysis,
their spans can be tied to the attribute responsible for their creation.

For example, overlapping field domains:

![](https://cdn.adinack.dev/cse-291/static-analysis-error.png)
> This error is fabricated for demonstrating span redirection.

## Public Contributions

[stm32g4xx-hal](https://github.com/stm32-rs/stm32g4xx-hal) is migrating
to the new PAC generated with the new field accessor methods we
introduced in [update 0](../update-0) which allowed for the merge
of the fully type-enforced CORDIC interface outlined in
[this](../../blog/better-hals-first-look) blog post. [PR](https://github.com/stm32-rs/stm32g4xx-hal/pull/144)

[darling](https://github.com/TedDriggs/darling) did not correctly parse
meta words for structs that implement `Default`. [PR](https://github.com/TedDriggs/darling/pull/313)

All code for this project now resides in the `proto-hal` crate [here](https://github.com/AdinAck/proto-hal).

## Next Up

- How are inter-register entitlements and effects to be implemented? Should some kind of register-coupling concept be introduced?
- Using constant evaluation to conduct static analysis.
- `TransitionBuilder`
  - lossy transitions (when a field is isolated)
