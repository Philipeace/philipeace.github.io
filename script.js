console.log("Philipeace: Art, Tech, and Sustainability in motion.");

// Smooth scrolling for all internal links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener("click", function(e) {
    const targetID = this.getAttribute("href");
    const targetElement = document.querySelector(targetID);
    if (targetElement) {
      e.preventDefault();
      targetElement.scrollIntoView({ behavior: "smooth" });
    }
  });
});
