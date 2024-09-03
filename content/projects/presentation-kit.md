+++
title = "PresentationKit"
date = 2023-07-12
draft = false
interests = ["swift", "swiftui", "graphics", "tools"]
summary = "Create stunning presentations with the power of SwiftUI."
github = "https://github.com/AdinAck/PresentationKit"
+++

Create stunning presentations with the power of SwiftUI.

{{< video src="https://cdn.adinack.dev/presentation-kit-demo.mp4" controls="false" muted="true" autoplay="true" loop="true" >}}

## Installation

**XCode Package Manager**

Add this repo to your SwiftUI project via the package manager.

```txt
https://github.com/AdinAck/PresentationKit
```

## Usage

**MyApp.swift**

```swift
import SwiftUI
import PresentationKit

@main
struct MyApp: App {
    @StateObject var presentation = Presentation(bgColor: .white, slides: [
        Title(),
        // put more slides here
    ])

    var body: some Scene {
        PresentationScene(presentation: presentation)
    }
}
```

## Examples

Refer to this [example project](https://github.com/AdinAck/ExamplePresentation) to see **PresentationKit** in action.
