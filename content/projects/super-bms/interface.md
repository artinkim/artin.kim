+++
title = "Interface"
draft = false
summary = "The SuperBMS uses a bidirectional UART interface for programming or reading values while in use."
weight = 2
+++

## Connections
The SuperBMS uses a bidirectional UART interface for programming or reading values while in use.

On the bottom right of the board next to the microcontroller are the UART optocouplers.
The pins have the following labels:
- GND - Digital low
- Rx - Receive (data into BMS)
- Tx - Transmit (data out of BMS)
- VDD - Digital high (3.3v)

## Usage
The **default baudrate** of the BMS is **9,600** but can go up to **20,000,000**. (see [UART Baudrate](/projects/super-bms/ratings#uart-baudrate))

There are 9 **configurable** values, and 6 **readable** values.
In order to configure or read any values to and from the BMS a **command** must first be sent.
The **command** will be interpreted as an **integer** value.
For values that are to be written, the data following the command will be interpreted as the **character** value for each sent byte.

Example:
1. BMS receives byte \x85
2. BMS converts \x85 to int 133
3. BMS receives bytes b'3.85'
4. BMS converts b'3.85' to float 3.85

Make sure not to send b'133' for command 133, this will **not** work.

In the following explanations, **"Value Type"** will refer to the value type **after** conversion from characters.

### Important Note

When reading values from the BMS, make sure to **wait** between sending the command and reading from the BMS. The **length** of this wait depends on the **data rate** of the ADCs and the **current activity** of the BMS, for it can only transmit/receive data at the **end** of every update, meaning if a charge/balance/discharge cycle is in progress the BMS will **not** respond on the UART bus until the cycle is over.

## Configurable Values
- [Mode](/projects/super-bms/interface#mode)
- [Maximum temperature](/projects/super-bms/interface#maximum-temperature)
- [Fan trigger temperature](/projects/super-bms/interface#fan-trigger-temperature)
- [Minimum cell voltage](/projects/super-bms/interface#minimum-cell-voltage)
- [Maximum cell voltage](/projects/super-bms/interface#maximum-cell-voltage)
- [Target cell voltage](/projects/super-bms/interface#target-cell-voltage)
- [Maximum cell voltage difference](/projects/super-bms/interface#maximum-cell-voltage-difference)
- [Time for charge/balance/discharge cycle](/projects/super-bms/interface#time-for-chargebalancedischarge-cycle)
- [Verbosity](/projects/super-bms/interface#verbosity)

## Readable Values
- [Total battery voltage](/projects/super-bms/interface#total-battery-voltage)
- [Battery capacity (percentage)](/projects/super-bms/interface#battery-capacity-percentage)
- [Mean cell voltage](/projects/super-bms/interface#mean-cell-voltage)
- [Minimum cell voltage](/projects/super-bms/interface#minimum-cell-voltage-1)
- [Maximum cell voltage](/projects/super-bms/interface#maximum-cell-voltage-1)
- [All cell voltages](/projects/super-bms/interface#all-cell-voltages)
- [Board temperatures](/projects/super-bms/interface#board-temperatures)
- [Status summary](/projects/super-bms/interface#status-summary)

***

### Mode
**Description:**
The BMS mode, being:
- 0 - Idle
- 1 - Charge/Balance/Discharge
- 2 - Emergency low power mode

**Command:**
128

**Value Type:**
Integer (0,1 or 2)

### Maximum temperature
**Description:**
The maximum temperature before BMS shuts down.

**Command:**
129

**Value Type:**
Float / Integer

### Fan trigger temperature
**Description:**
The temperature in which the fan will activate.

**Command:**
130

**Value Type:**
Float / Integer

### Minimum cell voltage
**Description:**
The minimum voltage any cell can be before the alarm goes off.

**Command:**
131

**Value Type:**
Float / Integer

### Maximum cell voltage
**Description:**
The maximum voltage any cell can be before the alarm goes off.

**Command:**
132

**Value Type:**
Float / Integer

### Target cell voltage
**Description:**
The voltage in which the BMS will attempt to attain during the charge/balance/discharge cycle (mode 1).

**Command:**
133

**Value Type:**
Float / Integer

### Maximum cell voltage difference
**Description:**
The cell voltage difference that the BMS will attempt to balance the cells to during balancing.

**Command:**
134

**Value Type:**
Float / Integer

### Time for charge/balance/discharge cycle
**Description:**
The amount of time the charge/balance/discharge cycle will last between cell measurements.

**Command:**
135

**Value Type:**
Integer

### Verbosity
**Description:**
The verbosity of the microcontroller's USB serial console.

**Command:**
136


***

### Total battery voltage
**Description:**
The summed voltage of all battery cells.

**Command:**
1

**Value Type:**
Float

**Number of Bytes:**
7

### Battery capacity (percentage)
**Description:**
The remaining charge of the battery as represented by a percentage.

**Command:**
2

**Value Type:**
Integer

**Number of Bytes:**
2

### Mean cell voltage
**Description:**
The average cell voltage of all cells.

**Command:**
3

**Value Type:**
Float

**Number of Bytes:**
7

### Minimum cell voltage
**Description:**
The minimum cell voltage.

**Command:**
4

**Value Type:**
Float

**Number of Bytes:**
7

### Maximum cell voltage
**Description:**
The maximum cell voltage.

**Command:**
5

**Value Type:**
Float

**Number of Bytes:**
7

### All cell voltages
**Description:**
A list of all cell voltages.

**Command:**
6

**Value Type:**
List of floats

**Number of Bytes:**
160

### Board temperatures
**Description:**
A list of all board temperatures.

**Command:**
7

**Value Type:**
List of floats

**Number of Bytes:**
30

### Status summary
**Description:**
A list of integers depicting the state of the BMS.

Meaning of value at index:

0. BMS is in emergency low power mode
1. Minimum cell is below warning voltage.
2. Minimum cell is below minimum voltage.
3. Maximum cell is above maximum voltage.
4. A fatal measurement/battery error occurred.
5. Maximum cell difference exceeds specified maximum cell difference for balancing.
6. Maximum board temperature exceeds maximum acceptable temperature.


**Command:**
8

**Value Type:**
List of integers

**Number of Bytes:**
7
