---
name: Dashwise
description: All-in-one homelab dashboard featuring a modern, frosted glass-look.
colors:
  primary: "oklch(79.258% 0.14708 222.532)"
  secondary: "oklch(85.142% 0.0001 271.152)"
  background: "oklch(1 0 0)"
  foreground: "oklch(100% 0.00011 271.152)"
  border: "oklch(20% 0.00011 271.152)"
typography:
  sans:
    fontFamily: "Geist, sans-serif"
  mono:
    fontFamily: "Geist Mono, monospace"
rounded:
  md: "0.625rem"
  sm: "calc(0.625rem - 4px)"
  lg: "0.625rem"
  xl: "calc(0.625rem + 4px)"
components:
  frosted:
    backgroundColor: "rgba(255, 255, 255, 0.1)"
    borderColor: "rgba(255, 255, 255, 0.2)"
  frosted-dark:
    backgroundColor: "rgba(0, 0, 0, 0.35)"
    borderColor: "rgba(255, 255, 255, 0.1)"
---

## Overview

Dashwise utilizes a modern, glassmorphic design system that prioritizes depth, clarity, and readability. The interface evokes a premium, lightweight feel by layering semi-transparent "frosted" elements over blurred backgrounds. It is designed to be highly legible and dynamic, adapting seamlessly to both light and dark environments.

## Colors

The color palette is built exclusively using `oklch` for consistent perceived lightness across the entire spectrum. It relies on a strong neutral foundation and cool-toned accents.

- **Primary:** A vibrant cool-toned accent used for interactive and active states.
- **Secondary:** A slightly muted complementary tone used for secondary actions.
- **Neutrals:** Pure and tinted values that drive the background and text contrast.
- **Frosted Transparencies:** Instead of opaque background colors, floating elements use semi-transparent white (`rgba(255, 255, 255, 0.1)`) or black (`rgba(0, 0, 0, 0.35)`) over blurred backdrops.

## Typography

The design system standardizes on the **Geist** font family, which provides a clean, technical, and structural aesthetic while remaining highly readable.

- **Geist (Sans):** Used for all standard UI text, labels, headings, and paragraphs.
- **Geist Mono:** Used for specialized contexts, such as metrics, code snippets, or technical data where tabular alignment is beneficial.

## Components

### Frosted Panels (Glassmorphism)

The signature UI element is the frosted panel, which serves as the container for widgets, cards, and overlays. It is composed of three distinct visual traits:
- **Translucent Fill:** A subtle white or black fill that allows the background to bleed through.
- **Backdrop Blur:** A medium blur (`backdrop-blur-md`) applied to whatever sits beneath the panel.
- **Delicate Borders:** A low-opacity border (`border-white/20`) to define the edge and provide a subtle highlight.
- **Elevation:** A small drop shadow (`shadow-sm`) to lift the panel off the canvas.

These frosted elements react to hover states by slightly increasing opacity to encourage user interaction.
These surface elements should also not get overused. The dashboard should have a clean, uncluttered look.

### Shadcn.ui
This project uses modified shadcn.ui components. They provide simplicity as a baseline.