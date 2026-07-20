# Canva Interaction Reference Guide

This document provides specific browser-use automation selectors, coordinates guidance, keyboard shortcuts, and UI traversal workflows for Canva.com.

---

## Editor Layout & Key Selectors

Canva's editor consists of a left-hand navigation sidebar, a left panel drawer (for assets/text search), a top navigation bar (for document actions/effects), and the central canvas workspace.

### 1. Left Sidebar Navigation
Used to switch tabs in the asset drawer.
- **Design/Templates Tab**: Use it to search base layout templates.
- **Elements Tab**: Selectors or text labels matching `Elements` (has icon containing circles, squares, triangles).
- **Text Tab**: Selectors or text labels matching `Text` (has "T" letter icon).
- **Uploads Tab**: Selectors or text labels matching `Uploads` (has cloud icon with upward arrow).
- **Projects Tab**: Selectors or text labels matching `Projects` (has folder icon).

### 2. Search & Element Selection
Once a sidebar tab is active, use the drawer search bar to locate assets:
- **Elements Search Bar**: Find input fields with placeholders like `Search elements`, `Search shapes, graphics, photos`, or standard inputs inside the Elements panel drawer.
- **Adding Text**: Click the button labeled `"Add a text box"`, `"Add a heading"`, `"Add a subheading"`, or `"Add a little bit of body text"` in the Text panel.

### 3. File Uploads
To upload logos, images, or assets:
- Select the **Uploads** tab.
- Click the `"Upload files"` button.
- Use the file upload injection handler in browser-use to feed the absolute path of the local asset to the file chooser.

### 4. Position & Precision Editing Panel
Canva provides numeric controls that are much more reliable than dragging.
- **Opening the Panel**: Select an element, then click the **Position** button in the top horizontal formatting bar.
- **Coordinates & Dimensions**: In the Position panel (Arrange tab), use text fields for:
  - `Width` (px)
  - `Height` (px)
  - `X` (horizontal position in px)
  - `Y` (vertical position in px)
  - `Rotate` (rotation angle in degrees)
- **Layers Panel**: Switch to the **Layers** tab in the Position panel to select overlapping or background elements that are hard to click on the canvas.

---

## Keyboard Shortcuts for Automation

Canva has robust keyboard shortcuts. Focus the page body before sending these shortcuts.

| Action | Shortcut |
| :--- | :--- |
| **Add Text Box** | Send key `t` |
| **Add Rectangle** | Send key `r` |
| **Add Circle** | Send key `c` |
| **Add Line** | Send key `l` |
| **Undo** | Send keys `Control+z` (Windows/Linux) or `Meta+z` (Mac) |
| **Redo** | Send keys `Control+y` (Windows/Linux) or `Meta+Shift+z` |
| **Duplicate Selected** | Send keys `Control+d` |
| **Delete Selected** | Send key `Delete` or `Backspace` |
| **Group Elements** | Select multiple and send keys `Control+g` |
| **Ungroup Elements** | Select group and send keys `Control+Shift+g` |
| **Nudge Element 1px** | Arrow keys (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`) |
| **Nudge Element 10px** | Shift + Arrow keys |

---

## Editor Surface Interaction Strategy

Because the main design area is rendered on a `<canvas>` element, direct DOM queries on layout elements will fail. Use the following strategies:

### 1. Element Interaction by Coordinates
To select or manipulate an element on the canvas:
- Calculate coordinates relative to the canvas bounding rect.
- Use `click_at_xy(x, y)` to select.
- Double-click to edit text contents.

### 2. Precise Layout Grid
- Canvas dimensions default to the design template size.
- Utilize coordinate offsets from the center of the canvas or top-left corner of the canvas container.

### 3. Text Injection Workflow
1. Add a text box (using shortcut `t` or clicking `"Add a text box"`).
2. Ensure the text frame is focused (cursor active).
3. Select all existing default text using `Control+a`.
4. Type or send the target text string via key inputs.
5. Open the font size and font family menus on the top formatting bar to apply analyzed fonts and sizes.
