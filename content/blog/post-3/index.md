+++
title = 'Such an Amazing Website'
date = 2023-03-15T11:00:00-07:00
draft = false
tags = ['red','green','blue']
summary = "This is a summary..."
+++

Hello.

This is all.

```rust
#![no_std]
#![no_main]

mod fmt;

use core::u16;

use embassy_time::Timer;
use fixed::{consts::PI, types::I16F16};
use foc::{
    park_clarke::TwoPhaseReferenceFrame,
    pwm::{Modulation, SpaceVector},
};
#[cfg(not(feature = "defmt"))]
use panic_halt as _;
#[cfg(feature = "defmt")]
use {defmt_rtt as _, panic_probe as _};

use embassy_executor::Spawner;
use embassy_stm32::{
    gpio::OutputType,
    rcc,
    time::khz,
    timer::{
        complementary_pwm::{ComplementaryPwm, ComplementaryPwmPin},
        simple_pwm::PwmPin,
        Channel, CountingMode,
    },
};
use fmt::info;

#[embassy_executor::main]
async fn main(_spawner: Spawner) {
    let mut rcc_config = rcc::Config::default();
    {
        use rcc::*;
        rcc_config.pll = Some(Pll {
            source: PllSource::HSI, // 16MHz
            prediv_m: PllM::DIV4,   // /4 = 4MHz
            mul_n: PllN::MUL85,     // x85 = 340MHz
            div_p: None,
            div_q: None,
            div_r: Some(PllR::DIV2), // /2 = 170MHz
        });
        rcc_config.mux = ClockSrc::PLL;
    }

    let mut peripheral_config = embassy_stm32::Config::default();
    peripheral_config.rcc = rcc_config;

    let p = embassy_stm32::init(peripheral_config);

    let mut pwm = ComplementaryPwm::new(
        p.TIM1,
        Some(PwmPin::new_ch1(p.PA8, OutputType::PushPull)),
        Some(ComplementaryPwmPin::new_ch1(p.PA7, OutputType::PushPull)),
        Some(PwmPin::new_ch2(p.PA9, OutputType::PushPull)),
        Some(ComplementaryPwmPin::new_ch2(p.PB0, OutputType::PushPull)),
        Some(PwmPin::new_ch3(p.PA10, OutputType::PushPull)),
        Some(ComplementaryPwmPin::new_ch3(p.PB9, OutputType::PushPull)),
        None,
        None,
        khz(30),
        CountingMode::CenterAlignedBothInterrupts,
    );

    let max_duty = pwm.get_max_duty();

    info!("Max duty: {}", max_duty);

    pwm.set_dead_time(5);
    pwm.set_duty(Channel::Ch1, 100);
    pwm.set_duty(Channel::Ch2, max_duty - 100);
    pwm.set_duty(Channel::Ch3, 100);
    pwm.enable(Channel::Ch1);
    pwm.enable(Channel::Ch2);
    pwm.enable(Channel::Ch3);

    let mut angle = I16F16::from_num(0);

    loop {
        let (alpha, beta) = cordic::sin_cos(angle);

        info!("angle: {}", angle.to_num::<f32>());

        info!(
            "alpha-beta: {}, {}",
            alpha.to_num::<f32>(),
            beta.to_num::<f32>()
        );

        let [u, v, w] = SpaceVector::as_compare_value::<2833 /* equivalent of max_duty */>(
            TwoPhaseReferenceFrame { alpha, beta },
        );

        let (u, v, w) = (u / 10, v / 10, w / 10);

        info!("phases: {}, {}, {}", u, v, w);

        // pwm.set_duty(Channel::Ch1, u);
        // pwm.set_duty(Channel::Ch2, v);
        // pwm.set_duty(Channel::Ch3, w);

        angle += I16F16::from_num(PI / 4);

        Timer::after_millis(1000).await;
    }
}

```

![Bryce Canyon National Park](bryce-canyon.jpg)

Sit excepteur do velit veniam mollit in nostrud laboris incididunt ea. Amet eu cillum ut reprehenderit culpa aliquip labore laborum amet sit sit duis. Laborum id proident nostrud dolore laborum reprehenderit quis mollit nulla amet veniam officia id id. Aliquip in deserunt qui magna duis qui pariatur officia sunt deserunt.
