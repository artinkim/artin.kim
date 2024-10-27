+++
title = "CodeX"
date = 2024-10-27
draft = false
interests = ["swift", "swiftui", "graphics", "tools"]
summary = "Expression defined code views for animation."
github = "https://github.com/AdinAck/CodeX"
+++

{{< video src="https://cdn.adinack.dev/CodeX/demo.mp4" controls="false" muted="true" autoplay="true" loop="true" >}}

## Usage

```swift
struct ContentView: View {
    var body: some View {
        Code {
            Block([.braces]) {
                Line(.comma) {
                    Property("a")
                    TypeName("u32")
                }
                Line(.comma, comment: "a value of type T") {
                    Property("b")
                    TypeName("T")
                }
            } before: {
                Keyword("struct")
                Space()
                TypeName("Foo")
                Token("<")
                TypeName("T")
                Token(">")
                Space()
            }
        }
    }
}
```

This project is very useful when combined with [PresentationKit](/projects/presentation-kit).
