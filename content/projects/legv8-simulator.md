+++
title = "LEGv8 Simulator"
date = 2022-09-25
draft = false
interests = ["swiftui", "tools"]
summary = "A SwiftUI application for writing, executing, and debugging LEGv8 assembly code with a series of visual tools."
github = "https://github.com/AdinAck/LEGv8-Simulator"
featured = "true"
+++

A SwiftUI application for writing, executing, and debugging LEGv8 assembly code with a series of visual tools.

{{< video src="https://cdn.adinack.dev/legv8-simulator-demo.mp4" controls="false" muted="true" autoplay="true" loop="true" >}}

![](https://cdn.adinack.dev/legv8-simulator-screenshot.png)

## Download
Here you can download the [latest release](https://github.com/AdinAck/LEGv8-Simulator/releases/).

## Usage
### Editing text
The top left panel is the Monaco Text Editor from VSCode, it supports all the standard shortcuts and QoL features (even the command pallette).

### Execution
There are three buttons in the top right:
- Assemble - Assemble the code for execution (cmd + b)
- Step - Execute the next instruction (cmd + k)
- Run/Continue - Execute the rest of the instructions (cmd + l)
- Stop - Go back to beginning of program (cmd + j)

### Console

Below the text editor, there is a "console" displaying a history of instructions executed, the current line of execution, the program counter and line number values for each instruction, and errors if they occur.

### Indicators

In the **Registers** and **Memory** panes, blue dots indicate the value was changed and purple dots indicate it was read.

In the **Memory** pane, the green dot indicates the position of the stack pointer and the orange dot indicates the position of the frame pointer.

### Inspector

In the **Memory** pane, you can select memory addresses and open the inspector to view the values of the memory addresses and how they compare and change as the program executes.

![](https://cdn.adinack.dev/legv8-simulator-inspector.png)

### Debugging

Just above the console, there are two buttons: *breakpoints* and *step over*.

The breakpoints button lets you type in which lines you would like the execution to pause on.

The step over button is only active when the execution cursor is on a `bl` instruction. If you press it, it will execute until the cursor is at the next line (i.e. the function returns).

### Preferences
You can access the preferences window by pressing `cmd + ,`.

Here you can configure some settings and view the about page.

## Command Line Utility
This project also contains a command line utility that executes a selected LEGv8 assembly file and dumps the state of the CPU at the end of the program to the selected file.

The execution of the file is extremely verbose and any assembly or runtime errors are displayed.
