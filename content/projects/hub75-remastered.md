+++
title = "Hub75 Remastered"
date = 2024-05-05
draft = false
interests = ["rust", "embedded", "graphics"]
summary = "A completely rewritten driver for HUB75 displays."
github = "https://github.com/AdinAck/hub75-remastered"
+++

{{< gallery >}}
  {{< img src="https://cdn.adinack.dev/hub75-remastered-IMG_3958.jpeg" >}}
  {{< img src="https://cdn.adinack.dev/hub75-remastered-IMG_4191.jpeg" >}}
  {{< img src="https://cdn.adinack.dev/hub75-remastered-06-06-2024-07-57-58.jpeg" >}}
  {{< img src="https://cdn.adinack.dev/hub75-remastered-14-08-2024-08-21-19.jpeg" >}}
{{< /gallery >}}

A completely rewritten driver for HUB75 displays.

## Usage

The `embedded-hal` version must be selected with the feature gates `hal-02` or `hal-1`.

---

Create an instance of a display (for example 64x32)

```rust
type Display = Hub75_64_32_2<
    3, // color bits
    (/* upper color pins */),
    (/* lower color pins */),
    (/* row pins */),
    (/* data pins */),
>;

let mut display = Display::new(/* pins */);
```

---

In a continually running background task, draw to the display

```rust
async fn bg_task(display: Display) {
    loop {
        display.output(/* delay provider */);
        // maybe yield to other same priority tasks
    }
}
```
