"use strict";

document.addEventListener("DOMContentLoaded", () => {

  const slider = document.querySelector(".hero-slider");
  const slides = document.querySelectorAll(".hero-slide");
  const dots = document.querySelectorAll(".slider-dot");
  const previousButton = document.querySelector(".slider-arrow-left");
  const nextButton = document.querySelector(".slider-arrow-right");

  if (
    !slider ||
    slides.length === 0 ||
    dots.length !== slides.length ||
    !previousButton ||
    !nextButton
  ) {
    console.warn("Hero slider could not be initialized.");
    return;
  }

  let currentSlide = 0;
  let automaticSlider = null;

  // Change this number to control the speed.
  // 5000 = 5 seconds
  // 3000 = 3 seconds
  const slideDuration = 5000;


  function showSlide(index) {

    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === index;

      slide.classList.toggle("active", isActive);
      slide.setAttribute("aria-hidden", String(!isActive));
    });

    dots.forEach((dot, dotIndex) => {
      const isActive = dotIndex === index;

      dot.classList.toggle("active", isActive);
      dot.setAttribute("aria-current", isActive ? "true" : "false");
    });

    currentSlide = index;
  }


  function showNextSlide() {
    const nextSlide = (currentSlide + 1) % slides.length;
    showSlide(nextSlide);
  }


  function showPreviousSlide() {
    const previousSlide =
      (currentSlide - 1 + slides.length) % slides.length;

    showSlide(previousSlide);
  }


  function startAutomaticSlider() {

    stopAutomaticSlider();

    automaticSlider = window.setInterval(
      showNextSlide,
      slideDuration
    );
  }


  function stopAutomaticSlider() {

    if (automaticSlider !== null) {
      window.clearInterval(automaticSlider);
      automaticSlider = null;
    }
  }


  nextButton.addEventListener("click", () => {
    showNextSlide();
    startAutomaticSlider();
  });


  previousButton.addEventListener("click", () => {
    showPreviousSlide();
    startAutomaticSlider();
  });


  dots.forEach((dot, index) => {

    dot.addEventListener("click", () => {
      showSlide(index);
      startAutomaticSlider();
    });

  });


  // Pause while the visitor's mouse is over the banner.

  slider.addEventListener("mouseenter", stopAutomaticSlider);
  slider.addEventListener("mouseleave", startAutomaticSlider);


  // Pause while the visitor is using keyboard controls.

  slider.addEventListener("focusin", stopAutomaticSlider);
  slider.addEventListener("focusout", startAutomaticSlider);


  // Keyboard navigation.

  slider.addEventListener("keydown", event => {

    if (event.key === "ArrowRight") {
      showNextSlide();
      startAutomaticSlider();
    }

    if (event.key === "ArrowLeft") {
      showPreviousSlide();
      startAutomaticSlider();
    }

  });


  showSlide(0);
  startAutomaticSlider();

});
