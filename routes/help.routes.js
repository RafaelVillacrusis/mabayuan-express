const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/help/:page", (req, res) => {
  const allowed = ["about", "faq", "privacy-policy", "terms-and-conditions"];
  const page = req.params.page;
  if (!allowed.includes(page)) {
    return res.status(404).send("Page not found.");
  }
  res.sendFile(path.join(__dirname, `../help/${page}.html`));
});

module.exports = router;
