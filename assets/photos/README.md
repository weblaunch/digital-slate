# Photos

This folder is for photos and screenshots that help people understand, build,
or document Digital Slate.

Useful image types:

- Finished slate, master, and slave devices.
- Internal wiring and board layouts.
- Close-ups of pin connections.
- Breadboard or prototype stages.
- Battery, display, RF24, OLED, hall sensor, and button placement.
- App screenshots that belong in the public README or docs.
- DaVinci Resolve screenshots showing the helper workflow.

Suggested naming:

```text
slate-front.jpg
slate-inside-wiring.jpg
master-ltc-input.jpg
slave-ltc-output.jpg
rf24-wiring.jpg
resolve-script-menu.png
app-takes-screen.png
```

Prefer small, web-friendly files where possible:

- Use `.jpg` for photos.
- Use `.png` for screenshots or diagrams.
- Avoid very large original camera files in the repo.
- Remove private production information before committing screenshots.

Reference images from Markdown with relative paths, for example:

```markdown
![Slate wiring](../assets/photos/slate-inside-wiring.jpg)
```

Hardware build images should normally be linked from
[../../docs/hardware.md](../../docs/hardware.md). App and workflow screenshots
can be linked from the top-level [../../readme.md](../../readme.md) or from the
relevant tool README.
