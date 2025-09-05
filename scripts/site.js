console.log("Ludic Historian");

document.documentElement.classList.replace("no-js", "js");

document.querySelectorAll("pre code").forEach((element) => {
  let html = element.outerHTML;
  let pattern = html.match(/\s*\n[\t\s]*/);

  if (pattern) {
    element.outerHTML = html.replace(new RegExp(pattern[0], "g"), "\n");
  }
});
