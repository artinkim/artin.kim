+++
title = "CSE 291 Project Propositum"
date = 2024-10-15
draft = false
+++

Embedded system firmware has been written in C for decades, but recently a movement to use Rust instead has surfaced.

The Embedded Rust project is still in its infancy, and demands careful attention and consideration for its emerging design.

You probably know this already, and are aware of the benefits of Rust in any system, for this propositum I will outline the
scope of the project, what has been done, what is to be done, the future, motivation, etc.

## Table of Contents
- [Goal](#goal)
- [Ecosystem](#ecosystem)
- [Motivation](#motivation)
  - [C](#c)
  - [Rust](#rust)

## Goal

My work involves the fortification of the interfaces exposed by the entire Embedded Rust stack. Maximization of safety, ergonomics, and
performance is paramount.

The scope of this project will be some subset of this work, which will be elaborated later.

Prior work: [Better HALs: First Look](/blog/better-hals-first-look)

## Ecosystem

It is important to understand the architecture of the Embedded Rust ecosystem, it is as follows:

```mermaid
flowchart TD
    A[SVD Parsing] --> B
    B[Patching] --> |Codegen| C
    C[PAC] --> D
    C .-> E
    D[HAL] --> E
    E[Application]
```

Every layer represents an independent Rust crate.

1. SVD[^1] files are parsed and reconstituted as YAMLs.
1. Manual patches are applied (because vendors take pride in their rate of error).
1. These patches are used to generate representative structures for register blocks/fields/types which
is called the PAC[^2].
1. The HALs define higher level structures which use the PAC internally.
1. The application uses the HAL structures and the PAC for any holes in the HAL

My work spans across this entire domain.

## Motivation

As a *safety-ciritcal* aware system designer, I indulge myself in any and all methods of maximizing **guarantees** of any kind.

Whether it be verification that some component of the system behaves in some way no matter what, or that the fundamental ideas
behind some design pattern will always scale to whatever application may use them.

Rust as a language (if properly coerced) can provide us with incredible guarantees about our system, let's look at a common example.

"I want EXTI to fire on the rising edge of pin PB3."

### C

Manufacturers provide direct and fragile abstractions for us to use.

To achieve our goal looks like this:

```c
void main() {
    // enable GPIOB clock
    RCC->AHB2ENR |= RCC_AHBENR_GPIOBEN;

    // configure PB3 as input
    GPIOB->MODER &= ~GPIO_MODER_MODER3_Msk;
    GPIOB->MODER |= (0x00 << GPIO_MODER_MODER3_Pos);

    // disable PB3 pull-up/down
    GPIOB->PUPDR &= ~GPIO_PUPDR_PUPDR3_Msk;

    // enable SYSCFG clock
    RCC->APB2ENR |= RCC_APB2ENR_SYSCFGEN;

    // for lane 3, select port B
    SYSCFG->EXTICR[0] &= SYSCFG_EXTICR1_EXTI3_Msk;
    SYSCFG->EXTICR[0] |= SYSCFG_EXTICR1_EXTI3_PB;

    // unmask lane 3
    EXTI->IMR1 |= EXTI_IMR1_IM3;

    // configure lane 3 for rising edge triggering
    EXTI->RTSR1 |=  EXTI_RTSR1_RT3;
    EXTI->FTSR1 &= ~EXTI_FTSR1_FT3;

    // not even going to show the IRQ response code
}
```

I want to make it extremely clear that this code **terrifies** me, here's why!

1. In order to configure the EXTI peripheral, we interacted with... **3** other peripherals? I wonder
who else is interacting with those peripherals...
1. I tricked you, that code is *not* correct and catastrophically so, could you tell?
The compiler sure couldn't!
1. Is this code context agnostic? In other words, could changing code *outside* of this function
render it inoperable?

The answers to all of these questions are:

1. Who knows
1. No you couldn't
1. With ease

All of which result it **silent incorrectness**.

> The correction to make the code work as expected is:
> ```diff
> -SYSCFG->EXTICR[0] &=  SYSCFG_EXTICR1_EXTI3_Msk;
> +SYSCFG->EXTICR[0] &= ~SYSCFG_EXTICR1_EXTI3_Msk;
> ```

We are here to talk about Rust though, so let's quickly stop writing any C and look at how Rust would handle this.

### Rust

Rather than providing raw structs to memory regions, PACs generate types that correspond to register blocks and fields:

```rust
#[entry]
fn main() -> ! {
    // acquire all peripherals
    let p = Peripherals::take();

    // enable GPIOB clock
    p.RCC.ahb2enr().write(|w| {
        w.gpioben().enabled();
    });

    // configure PB3 as input
    p.GPIOB.moder().write(|w| {
        w.moder3().input();
    });

    // disable PB3 pull-up/down
    p.GPIOB.pupdr().write(|w| {
        w.pupdr3().floating();
    });

    // enable SYSCFG clock
    p.RCC.apb2enr().write(|w| {
        w.syscfgen().enabled();
    });

    // for lane 3, select port B
    p.SYSCFG.exticr1().write(|w| {
        w.exti3().portb();
    });

    // unmask lane 3
    p.EXTI.imr1().write(|w| {
        w.im3().unmasked();
    });

    // configure lane 3 for rising edge triggering
    ctx.device.EXTI.rtsr1().write(|w| w.rt3().enabled());
    ctx.device.EXTI.ftsr1().write(|w| w.ft3().disabled());

    // still not going to show the IRQ response code
}
```

Are the comments even necessary any more?

[^1]: SVD files are provided by the manufacturer and outline the register map for the entire device.
[^2]: PAC: **P**eripheral **A**ccess **C**rate
