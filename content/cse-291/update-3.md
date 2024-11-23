+++
title = "CSE 291 Project Update 3"
date = 2024-11-23
draft = false
unlisted = true
+++

This week's efforts were directed towards implementing the first
level of static analysis and the fascilitation of entitlements.

## Static Analysis

The first level of static analysis has been implemented:
- fields must be in order and cannot overlap
- fields must reside within the register (32 bits)

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
```

This register declaration is correct.

```rust
#[register(infer_offsets)]
pub struct Csr {
    #[field(read, write, reset = Cos)]
    func: Func,
    #[field(read, write, reset = P20)]
    precision: Precision,
    #[field(read, write, reset = N0)]
    scale: Scale,

    #[field(offset = 0x14, reset = Disabled)]
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
```

This register declaration produces both a field overlap error
and a register out of bounds error:

![](https://cdn.adinack.dev/cse-291/static-analysis-working.png)

Both of these errors are produced by panics during constant evaluation.

The `register` macro expands the struct as a module with many constants
for static analysis. The above errors are emitted by:

```rust
const _: () = {
    if !(argsize::OFFSET + super::data_size::WIDTH < rrdy::OFFSET) {
        {
            core::panicking::panic_fmt(core::const_format_args!(
                "field domains must be in order and non-overlapping. overlaps with argsize",
            ));
        };
    }
};
const _: () = {
    if !(rrdy::OFFSET + super::rrdy::WIDTH <= 32) {
        {
            core::panicking::panic_fmt(core::const_format_args!(
                "field domain exceeds register domain",
            ));
        };
    }
};
```

### Failure of This Approach

```rust
#[register(infer_offsets)]
pub struct Csr {
    #[field(read, write, reset = Cos)]
    func: Func,
    #[field(read, write, reset = P20)]
    precision: Precision,
    #[field(read, write, reset = N0)]
    scale: Scale,

    #[field(offset = 0x11, reset = Disabled)]
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
```

This register declaration is incorrect but produces
**no** compiler errors. Why?

There is a gap between `argsize` and `rrdy`, so shifting
all of those fields by one bit does not cause a colision
with `rrdy` nor the register bounds.

This is the kind of mistake which does not violate any
rules but is simply a misrepresentation of the hardware.

**How could we catch this?**

**How could we make this kind of error harder to make?**

## Entitlements

We've talked a lot about the idea of entitlements. But how
can these be enforced?

Back in the [project propositum](../propositum/#observation)
we introduced the idea of **observation** as a means of
representing resource usage by multiple peripherals, requiring
a *frozen* state of the observed peripheral component.

The word "observation" was a placeholder, and did not fully
encapsulate the purpose. While mutating the locked **state**
was not permitted (the state is frozen), invoking *actions*
on the locked peripheral component is still permitted.

For example, the SPI peripheral would want to lock a pin in
a particular alternate function. The `CLK` or `MOSI` pins
would be pulled high or low by the SPI peripheral, which
is certainly more involvement than purely an observation.

Well, as it turns out, the system we created for observation
*is exactly* what entitlements are!

For example, say multiple peripherals require a certain bus
characteristic to be in effect, let's say the `PLLQ` output
of the `RCC` PLL.

With standard move semantics (the classic way to represent
the forbidding of state change) would only allow **one**
peripheral to require this state to be frozen.

With the ~~observation~~ entitlement system, multiple
entitlement tokens can be dispatched to all peripherals
which require that state.

```rust
let ([tim15_entitlement, spi3_entitlement], frozen_pllq) = pllq.freeze();

// both of these peripherals hold the entitlement token
// as a means of requiring that state to be set
let tim15 = ctx.device.TIM15.attach(tim15_token);
let spi3 = ctx.device.SPI3.attach(spi3_token);

frozen_pllq.disable(); // does not compile, this method no longer is available
```

Let's look at this in action with the CORDIC peripheral.

The block struct is transformed into a fully generic struct like so:

```rust
struct Cordic<Csr, Wdata, Rdata> {
    csr: Csr,
    wdata: Wdata,
    rdata: Rdata,
}
```

But looking back at the declaration:

```rust
#[block(
    base_addr = 0x4002_1000,
    infer_offsets,
    entitlements = [super::ahb::cordic_en::Enabled]
)]
struct Cordic {
    csr: Csr,
    wdata: WData,
    rdata: RData,
}
```

This block is entitled to a particular state of the `ahb` bus controller.
The struct shall express this with an additional field:

```rust
struct Cordic<Csr, Wdata, Rdata, Entitlement0> {
    csr: Csr,
    wdata: Wdata,
    rdata: Rdata,

    entitlement0: Entitlement0,
}
```

So the reset type signature will be as follows:

```rust
type CordicReset = Cordic<csr::Reset, wdata::Reset, rdata::Reset, Unsatisfied>;
```

**All** method implementations will require the `Entitlement0` generic parameter
to be `Entitlement<T>`.

Let's see this in action:

```rust
let ahb = rcc.ahb.cordic_en::<Enabled>().transition(); // move ahb out of rcc and transition

let ([cordic_en_entitlement], frozen_cordic_en) = ahb.cordic_en.freeze(); // move cordic_en out of ahb and freeze

let cordic = ctx.device.CORDIC; // : Cordic<csr::Reset, wdata::Reset, rdata::Reset, Unsatisfied>

let cordic = cordic.csr(|reg| {
    reg.func::<Sin>().transition()
}); // does not compile: method csr(..) doesn't exist

let cordic = cordic.attach(cordic_en_entitlement); // : Cordic<csr::Reset, wdata::Reset, rdata::Reset, Entitlement<ahb::cordic_en::Enabled>>

let cordic = cordic.csr(|reg| {
    reg.func::<Sin>().transition()
}); // works
```

In this case the peripheral was entitled to a particular state,
but sometimes multiple states are valid. This would result in the
generic parameter of `Entitlement` to be promoted to a generic
of the impl block, with a trait requirement. This trait would
be generated and implemented by the `register` and `block` macros.
