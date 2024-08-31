const keyframes = [
  {
    opacity: 0,
    transform: "translate3d(0, 2rem, 0)",
    filter: "blur(0.5rem)",
  },
  {
    opacity: 1,
    transform: "translate3d(0, 0, 0)",
    filter: "blur(0px)",
  },
];

function entrance() {
  document.getElementsByTagName("main")[0].style.visibility = "visible";

  let elements = Array.from(document.querySelectorAll(".animate")).flatMap(
    (container) => Array.from(container.children),
  );

  elements
    .filter((element) => {
      element.checkVisibility();
      const { top, bottom } = element.getBoundingClientRect();
      return bottom > 0 && top < window.innerHeight;
    })
    .forEach((element, i) => {
      element.animate(keyframes, {
        duration: 500,
        easing: "cubic-bezier(0, 1, 1, 1)",
        delay: 50 * i,
        fill: "both",
      });
    });
}

document.onreadystatechange = () => {
  if (document.readyState === "complete") {
    setTimeout(entrance, 100); // insane safari bug
  }
};
