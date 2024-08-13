+++
title = "Firmware"
date = 2023-11-22
draft = false
summary = "Utilizing Embedded Rust to enable high frequency closed-loop control and communication."
github = "https://github.com/AdinAck/Headlights-Firmware"
weight = 1
+++

This repo contains firmware for:
- the headlights (stm32f031k6)
- the BLE relay (nrf52840)

as well as bindings for the [Swift app](/projects/headlights/app).

## Embedded Rust

This firmware is completely written in Embedded Rust, fully utilizing the magical powers of the Rust compiler.

For concurrency and peripheral access, [embassy](https://github.com/embassy-rs/embassy) is used.

## Safety

This firmware is designed with safety as the number one priority. All detectable events will trigger a safe shutdown, and all errors are appropriately handled.

## Commands

These two devices (headlight and relay) exchange commands with a robust and adaptable command pattern.

The structures defining this behavior are shared between both binaries, so it is not possible to accidentally introduce a discrepency.

A CRC is used to validate commands, and commands are dispatched statically so no global allocator is needed.

## BLE

Rather than the classic "pipe" model most bluetooth interfaces use where there is one characteristic for bytes sent and one for bytes received (basically a wireless UART). I designed a BLE stack that fully utilized BLE. Every piece of exchangable data has it's own characteristic, with appropriate read and write permissions.

Some of these characteristics, like the current state or error code of the device are notifying, so the phone (without even asking) will be informed of important information as it occurs.

This model is extremely powerful as it is scalable, event driven, and declarative (read more in the [app](/projects/headlights/app) repo).
