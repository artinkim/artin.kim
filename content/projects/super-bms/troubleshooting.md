+++
title = "Troubleshooting"
draft = false
summary = "Tips for troubleshooting the Super BMS."
weight = 4
+++

## Measurement Error
The SuperBMS will attempt to detect measurement errors by comparing cell voltages between measurements.

A **measurement error** will be announced by a **long tone** by the buzzer.

If a **measurement error** occurs, the BMS will **disable** the [Charge/Balance/Discharge](/projects/super-bms/usage#chargebalancedischarge) mode in order to avoid possible **damage**. The BMS will also **update** the [status summary](/projects/super-bms/interface#status-summary) at the corresponding index when requested.

### Finding the Problem
A **measurement error** could be a result of **4** possibilities:
- loose solder connections
- faulty op-amps
- faulty ADCs
- faulty battery

If an op-amp is **faulty** or **not** soldered properly, the op-amp could **saturate**, outputting around **8** volts. This exceeds the maximum voltage range of the inputs of the ADCs. When the ADCs read a voltage that is too high, the ADC will be **disconnected** from it's inputs, resulting in **floating** voltages to be recorded. The floating voltages are often close to **5** volts, or **0** volts, triggering a **measurement error**.

If the **battery** is damaged or faulty, it's voltages could **vary** greatly between measurements.

Rule out improper solder connections by **resoldering** the op-amps and ADCs, and using a **multimeter** or **oscilloscope** to confirm accurate voltages are being sent to the ADCs.

If the op-amps and ADCs are working, test the battery by putting it under **load**, and monitor the voltage **sag** of the battery.

***

## Recovering From Low Charge
If a battery cell has discharged **below** the [shutdown voltage](/projects/super-bms/usage#shutdownvoltage) the BMS _may_ be able to recover the battery, depending on the following:
- How low is the cell?
- How charged are other cells?
- Is the discharged cell one of the first 4 cells?

### How low is the cell?
If the cell has **not** discharged much more below the **shutdown voltage** the chances of recovery are high.

If the cell has continued to discharge below the **shutdown voltage** the chances of recovery are much less.

### How charged are other cells?
This is a very **important** question. If other cells are **much** higher than the discharged cell, the BMS may **not** be able to charge the discharged cell as fast, depending on when the other cells reach the [maximum cell voltage](/projects/super-bms/usage#maxvoltage).

### Is the discharged cell one of the first 4 cells?
If this is true, then this cell is partially responsible for **powering** the BMS. If any **balancing** is required during charging, the fan will draw a good amount of current from the first 4 cells, making it take **longer** to charge (not much longer but still significant with a very discharged cell).

***

**Any** of these 3 events could cause the discharged cell to **never** charge back up. If this is the case, the BMS will try to restore the battery to acceptable levels **indefinitely**.
