# Card art (optional)

Drop monster-card images in this folder and `build.js` embeds them into `index.html` as
data URIs, so the card-collection modal shows real art instead of the card's initials.

- **File name = card name**, with underscores standing in for spaces:
  `General_Umzaka.png` → the card `General Umzaka`.
- PNG, JPG, GIF or WebP. Square images look best (slots are 1:1).
- Names must match `database.csv` exactly (apart from the underscores); anything that
  doesn't match is simply ignored.

Slots with no matching file fall back to the card's initials, so this is entirely optional.
