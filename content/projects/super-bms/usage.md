+++
title = "Usage"
draft = false
summary = "The SuperBMS has 3 modes: Idle, Charge/Balance/Discharge, and Emergency Low Power."
weight = 1
+++

## Operation
The SuperBMS has 3 modes: Idle, Charge/Balance/Discharge, and Emergency Low Power.

### Idle
When the BMS is in idle mode, it will constantly monitor the cell voltages and board temperatures. If anything goes wrong, an alarm will be triggered, and a reason for the alarm will be printed to the serial console whether or not verbosity is turned on.

The BMS will **not** be able to charge/balance/discharge the battery at any time while in idle mode. The mode **must** be externally changed in order for the BMS to be able to charge/balance/discharge.

### Charge/Balance/Discharge
In this mode, the BMS will either charge, balance, or discharge the battery depending on what the [target voltage](/projects/super-bms/usage#targetvoltage) is.

In order for charging to work, an external battery charger must be connected. (see [Connections](/projects/super-bms/usage#connections))

If the battery is **balanced** and at the **target voltage**, the BMS mode will automatically switch back to **idle**, and 2 chirps will be played by the buzzer.

### Emergency Low Power
In the event that the battery is at a **critically low charge**, the BMS will switch to this mode.

In this mode, the BMS will try to save as much power as possible by doing the following:
- **Deactivate** ICs
- Important operations like **temperature regulation** and **alarms** will **not** be enabled
- Discontinue providing power to **P+** and **P-** terminals
- Turn **off** charger relay

The UART will remain **enabled** and **active**, although if the device communicating with the BMS was being **powered** by the BMS, it will **no longer** function.

If you want to **charge** the battery, the **reset** button must be pressed once a charger is **connected**. After the board resets, the BMS will enter **charge/balance/discharge** mode and will disregard the low charge error. Once the battery has **recovered** from the low charge state, the BMS will return to **normal operation**.

If the BMS **fails** to recover the battery, this likely means the battery is **damaged** or that the battery's charge was **too low** to recover from. (see [Recovering From Low Charge](/projects/super-bms/Troubleshooting#recovering-from-low-charge))

Furthermore, a very low battery could **damage** the BMS, or prevent it from functioning properly. Monitoring the BMS with the built-in USB port and your favorite serial monitor is **highly recommended**.

### Error State
In the event that an **unrecoverable** error occurred, resulting in an exception being raised in **CircuitPython**, the buzzer will play a long tone to indicate an error and the BMS will put all ADCs to sleep, **disconnect** all discharging resistors, **disconnect** the charger, turn **on** the fan until the board is cool, and then **exit**.

At this point, the BMS will need a **power cycle** or the **reset button** to be pressed.

Please create an **issue** on this repository if an error occurs.

## Connections
The SuperBMS has **8** connections.
- Main Battery Port
- B+ C+ P+
- B- C- P-
- UART


### Main Battery Port
The Main Battery Port is where the individual **cells** are connected to the BMS.

This port also supplies **power** to the BMS.

### B+ C+ P+
The battery, charger, and load **positives**. All connected together.

Current flow between these pads is **unregulated**.

### B- C- P-
The battery, charger, and load **negatives**.

A **relay** is between **B-** and **C-** for controlling whether the **charger** is connected or not.

A **MOSFET** is between **B-** and **P-** for controlling whether the **load** is connected or not.

### UART
The serial communications port. (see [Interfacing with the BMS](/projects/super-bms/interface))

## Code
**Only** modify the code if you **know** what you are doing.

In the [main](https://github.com/AdinAck/SuperBMS/blob/master/code/main.py) script, modules are imported, pins defined, objects are initialized, and the main loop is run.

The [BMS](https://github.com/AdinAck/SuperBMS/blob/master/code/BMS.py) object is where most of the stuff gets done, it also contains all of the important **variables**.

### Configuring the ADCs
Information on the ADCs (**ADS1248IPWR**) can be found here:
- [CircuitPython Library](https://github.com/AdinAck/ADS1248-CircuitPython)
- [Datasheet](https://www.ti.com/lit/ds/symlink/ads1248.pdf?ts=1596755210613&ref_url=https%253A%252F%252Fwww.ti.com%252Fproduct%252FADS1248)

### Changing variables
#### Here are the variables that can be changed:
- [mode](/projects/super-bms/usage#mode)
- [cellCount](/projects/super-bms/usage#cellcount)
- [maxTemp](/projects/super-bms/usage#maxtemp)
- [fanTrigger](/projects/super-bms/usage#fantrigger)
- [minVoltage](/projects/super-bms/usage#minvoltage)
- [maxVoltage](/projects/super-bms/usage#maxvoltage)
- [targetVoltage](/projects/super-bms/usage#targetvoltage)
- [warningVoltage](/projects/super-bms/usage#warningvoltage)
- [shutdownVoltage](/projects/super-bms/usage#shutdownvoltage)
- [dV](/projects/super-bms/usage#dv)
- [balTime](/projects/super-bms/usage#baltime)
- [errorDetect](/projects/super-bms/usage#errordetect)
- [verbose](/projects/super-bms/usage#verbose)

***

#### mode
Controls the mode the BMS is in, being:
- 0 - Idle
- 1 - Charge/Balance/Discharge
- 2 - Emergency Low Power

#### cellCount
The **number** of cells connected to the BMS.

#### maxTemp
The **maximum** allowed temperature for balancing/discharging.

### fanTrigger
The temperature in which the fan will be turned **on**.

#### minVoltage
The **minimum** cell voltage before **alarm**.

#### maxVoltage
The **maximum** cell voltage before **alarm**.

#### targetVoltage
The voltage the BMS will try to **achieve** during [Charge/Balance/Discharge](/projects/super-bms/usage#chargebalancedischarge).

#### warningVoltage
If a cell drops **below** this voltage, the BMS will set the corresponding index of the status summary to **True** when a device requests it.

#### shutdownVoltage
If a cell drops **below** this voltage, the BMS will switch to [Emergency Low Power](/projects/super-bms/usage#emergency-low-power) mode.

#### dV
The target maximum cell voltage difference for **balancing**.

#### balTime
The **duration** of the charge/balance/discharge cycle.

#### errorDetect
The **change** in voltage per cell **between measurements** to trigger a [Measurement Error](/projects/super-bms/troubleshooting#measurement-error).

#### verbose
Activates lots of print statements for the built-in USB console.
