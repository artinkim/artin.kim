+++
title = "Fourier Challenge 0"
date = 2025-01-12
draft = false
github = "https://github.com/AdinAck/fourier-challenge-0"
unlisted = true
+++

You can visit the GitHub repository by clicking the GitHub icon in
the top right of this page.

The project consists of three crates:
- common
- dummy
- main

"dummy" is the firmware for the pump-temp system simulator,
and "main" is the firmware for the *device* controlling and
monitoring the system.

Both microcontrollers are variants of the STM32G4 family.

For the production firmware "main", I elected to use RTIC
for the async executor and primitives, resource management, etc.

I used my fork of [stm32g4xx-hal](https://github.com/adinack/stm32g4xx-hal) for the HAL.
The maintainers and I are constantly improving this HAL, but some of my PRs are still pending
so I had to use my fork.

For the dummy, I elected to use Embassy because it is super easy to get things up and running
in no time.

Embassy is not fine-grained enough for production use in my opinion, which is why
I used RTIC for "main".

## Commands

The basis of this challenge is the exchange of commands between the two devices.

Fortunately, I developed a crate suite [embedded-command](https://github.com/adinack/embedded-command)
for this use case exactly.

In "common", commands are elaborated as enums and derive a serialization trait
from "cookie-cutter", a crate within embedded-command.

Temperature sensor commands:

```rust
#[derive(vanilla::SerializeIter)]
#[repr(u8)]
pub enum ToPeripheral {
    /// Request a new measurement.
    Read = 0xbe,
}

#[derive(vanilla::SerializeIter)]
#[repr(u8)]
pub enum FromPeripheral {
    /// A temperature value in Celsius.
    Temperature(Temperature) = 0xef,
}
```

Pump commands:

```rust
#[derive(Clone, Copy, vanilla::SerializeIter)]
#[cfg_attr(feature = "defmt", derive(defmt::Format))]
#[repr(u8)]
pub enum ToPeripheral {
    Set(PumpState) = 0xca,
    Get = 0x11,
}

#[derive(vanilla::SerializeIter)]
#[repr(u8)]
pub enum FromPeripheral {
    PumpState(PumpState) = 0xaa,
    Fault(Fault) = 0x1f,
}

#[derive(vanilla::SerializeIter)]
#[cfg_attr(feature = "defmt", derive(defmt::Format))]
#[repr(u8)]
pub enum Fault {
    Temperature = 0xde,
    Current = 0xad,
}
```

Since the command protocol of the peripherals were up to me,
I used the "vanilla" encoding scheme provided by cookie-cutter.

> The command structures used by both "dummy" and "main" are sourced
from "common".

## Main

The pump and temperature sensor round-robin routines are represented
by distinct concurrent tasks:

```rust
#[task(shared = [model])]
async fn temp(ctx: temp::Context, mut temp_sensor: TempSensor) {
    // for testing purposes
    Mono::delay(4u64.secs()).await;

    fmt::info!("begin...");

    match temp_sensor.run(ctx.shared.model).await {
        Ok(_) => {
            // shutdown
        }
        Err(fault) => {
            // handle fault
            fmt::panic!("{}", fault);
        }
    }
}

#[task(shared = [model])]
async fn pump(ctx: pump::Context, mut pump: Pump) {
    // for testing purposes
    Mono::delay(4u64.secs()).await;

    fmt::info!("begin...");

    match pump.run(ctx.shared.model).await {
        Ok(_) => {
            // shutdown
        }
        Err(fault) => {
            // handle fault
            fmt::panic!("{}", fault);
        }
    }
}
```
> Faults are "handled" by panicing because not enough
> information is provided to handle them gracefully.

The "model" resource shared by these two tasks
is the system model:

```rust
pub struct Model {
    target_temp: Temperature,

    history: HistoryBuffer<Entry, 8>,
    pending: (Option<Temperature>, Option<PumpState>),
}
```

The model retains state history and computes
the target pump state upon request.

I am not a controls expert and don't really know
how to model this system, so the model
used to perform inference is dead simple:

```rust
pub fn pump_target(&self) -> PumpState {
    let Some(entry) = self.history.oldest_ordered().last() else {
        // cool by default because likely
        // cool is safe
        return PumpState::On;
    };

    let target = if entry.temperature > self.target_temp {
        PumpState::On
    } else {
        PumpState::Off
    };

    fmt::info!("last entry: {}, target: {}", entry, target);

    target
}
```

Let's see how the peripheral interfaces
perform command exchange.

In `peripherals::temperature`:

```rust
pub async fn read_temperature(&mut self) -> Result<Temperature, Error> {
    // 1. send read command
    self.write_command(ToPeripheral::Read)?;
    fmt::trace!("sent read command");

    // 2. receive measurement command or timeout
    let FromPeripheral::Temperature(temp) =
        Mono::timeout_after(100u64.millis(), self.read_command()).await??;

    fmt::trace!("received temp: {}", temp);

    Ok(temp)
}
```
> The implementation details of actual DMA and UART
> usage are so gross I will not show them.
>
> The G4 HAL DMA interface is amazingly poorly
> designed.

...and this is done in a loop:

```rust
pub async fn run(&mut self, mut model: impl Mutex<T = Model>) -> Result<(), Error> {
    self.transfer_in.start(|_| {});

    loop {
        // 1. fetch latest measurement
        try_join(self.read_temperature(), async {
            Mono::delay(1u64.secs()).await;
            Ok(())
        })
        .await
        .and_then(|(measurement, _)| {
            // 2. update model
            model.lock(|model| {
                model.push_temperature(measurement);
            });

            Ok(())
        })?;
    }
}
```

The pump interface is mostly similar, except for this method:

```rust
pub async fn update_pump(&mut self, target: PumpState) -> Result<(), Error> {
    // 1. send pump state to pump
    let cmd = ToPeripheral::Set(target);
    self.write_command(cmd)?;
    fmt::trace!("sent cmd: {}", cmd);

    // 2. validate pump response
    match Mono::timeout_after(100u64.millis(), self.read_command()).await?? {
        FromPeripheral::PumpState(state) => {
            fmt::trace!("received state: {}", state);

            if state == target {
                Ok(())
            } else {
                Err(Error::NonConformance)
            }
        }
        FromPeripheral::Fault(fault) => Err(Error::Fault(fault)),
    }
}
```

One thing to note is the command receive futures
are dispatched upon a USART receive timeout.

This is achieved with the `rtic_sync::signal::Signal` concurrency primitive
which alerts the executor to poll the future on an interrupt event.

Fun fact, I actually am the author of this structure in RTIC.

## Dummy

The dummy has much less proper code structure, with `unwrap`s everywhere, which is
fine given its role.

The command exchange is basically the same as in "main", the only notable
difference being a new simulator task:

```rust
#[embassy_executor::task]
async fn simulator() {
    for _ in 0..50 {
        {
            let mut state = STATE.lock().await;

            fmt::info!("state: {}", *state);

            match state.1 {
                PumpState::Off => state.0 += 1,
                PumpState::On => state.0 -= 1,
            }
        }

        Timer::after_millis(500).await;
    }

    STATE.lock().await.2 = true;
}
```

This simulation plays out like so:

{{< video src="https://cdn.adinack.dev/fourier-challenge-0/logs.mp4" muted="true" >}}

According to the model, the pump turns on when the temperature exceeds 60C.

According to the simulation, a pump fault occurs after 25 seconds.

{{< video src="https://cdn.adinack.dev/fourier-challenge-0/real-life.mp4" controls="false" muted="true" autoplay="true" loop="true" >}}

---

I was rather busy this past week, and this was my first time using the DMA interface in this HAL, which I was very disappointed in.

Given more time I would procedurally generate the command ingestion and dispatch process with a procedural macro (future embedded-command work),
and I would use DMA on outbound bytes (the interface was so bad I could not do it).

And, of course, with more context actual fault handling would have been possible.
