+++
title = "Ratings"
draft = false
summary = "Ratings and characteristics of the Super BMS."
weight = 3
+++

## Ratings
### Cell Count
**4-20** cells
### Balance Resistor Heat dissipation
Maximum **4W** with heatsinks and active cooling

Much less than **4W** without heatsinks and active cooling
### Cell Voltage
**0-5** volts
### Charger Current
Maximum **16** amps as limited by [G5PZ](https://www.mouser.dk/datasheet/2/307/Omron_(ENG)G5PZ_E-1843616.pdf)
### Load Current
Maximum **10** amps as limited by [STD12N60DM2AG](https://www.st.com/resource/en/datasheet/std12n60dm2ag.pdf)
### UART Baudrate
Maximum **20** Mbps as limited by [TLP2770](https://www.mouser.com/datasheet/2/408/TLP2770_datasheet_en_20171115-1023006.pdf)
### Temperature
I am not equipped to test the **low-temperature** rating although I can say the board begins to smoke at around **150C** and chars at probably more than **400C**.
### Humidity
Do **not** get the BMS wet **at all** unless with **silicone conformal coating**.

## Characteristics
### Measurement Accuracy
Depends on charger noise, ADC data rate, and temperature as determined by: [INA149AID](https://www.ti.com/lit/ds/symlink/ina149.pdf), [ADS1248IPWR](https://www.ti.com/lit/ds/symlink/ads1248.pdf?ts=1596756432886&ref_url=https%253A%252F%252Fwww.ti.com%252Fproduct%252FADS1248), [MAX6225ACSA+](https://componentsearchengine.com/Datasheets/1/MAX6225ACSA+.pdf)
