# **Architectural and UI Specification for the Brave Browser Design System (Leo/Nala)**

The modern browser ecosystem demands an interface that seamlessly bridges native operating system performance with the flexibility of web-based front-end frameworks. The Brave Browser accomplishes this through a unified, cross-platform design system known as "Leo" for web and component environments, and codenamed "Nala" for native, C++, and Skia-based rendering1. This exhaustive specification provides a granular blueprint for replicating the Brave user interface, derived from internal architectural patterns, design tokens, component logic, and styling algorithms. The following analysis dissects every facet of the interface—from macro-level layout paradigms like vertical tab implementation to micro-level pixel rendering, border radii, typography baselines, and exact color hexadecimal codes—to serve as a definitive guide for engineering a pixel-perfect cloned interface.

## **System Architecture and the Token Pipeline**

The overarching design language is unified, but its implementation diverges strictly based on the underlying rendering engine. The architecture is split into two primary domains that consume the same foundational design tokens. The web-oriented framework, Leo, is authored primarily in the Svelte framework and serves as the central repository for Web Components, React wrappers, and raw HTML/CSS implementations used in internal browser pages such as the New Tab Page, Settings, and the Brave Wallet1. Conversely, Nala represents the C++ and Skia implementations of these identical design tokens, utilized for the native browser chrome, including the URL omnibox, the physical tab strip, and native context menus. Output files for the native environment are generated into the nala:: namespace, mapping exact color identifiers and border radii directly to the native graphics engine for hardware-accelerated rendering1.  
The analysis indicates that the user interface is constructed around a highly modular, automated pipeline. Design tokens originate in Figma via a specialized Design Tokens plugin2. These raw tokens are then processed through the Amazon Style Dictionary framework, which compiles them into cascading style sheets (CSS) variables, Tailwind configurations, Skia C++ headers, and native mobile resources for both Swift and Java1. For developers tasked with engineering a cloned interface, understanding this token-driven architecture is paramount. Rebuilding the web-based segments of the interface requires the inclusion of the compiled CSS variables. The system relies on a global variable file, typically sourced from a build directory, such as @brave/leo/build/css/variables.css, which serves as the absolute source of truth for all downstream styling logic2.

### **Theming Engine and Dynamic Resolution**

The user interface supports dynamic theme switching across Light, Dark, and System modes. The resolution of these themes relies on a dual-selector approach to ensure both global operating system compliance and localized component-level overrides. The rendering engine evaluates the relevant light or dark color variables automatically based on two primary criteria. The first criterion is the global CSS media query evaluating @media (prefers-color-scheme: dark) or @media (prefers-color-scheme: light). The second, and more specific criterion, is the closest HTML ancestor possessing a data-theme attribute, such as \<div data-theme="dark"\>2.  
This architectural choice allows the interface to force specific panels into a dark mode—such as Private Browsing windows or Tor windows—regardless of the overarching operating system preferences2. The native browser theme itself is managed via internal WebUI application programming interfaces (APIs). Specifically, the chrome.braveTheme.getBraveThemeType and chrome.braveTheme.setBraveThemeType endpoints accept the string types 'Light' and 'Dark' and emit an observable onBraveThemeTypeChanged event that forces a repaint of the active UI tree when a user transitions between themes5.

## **Exacting Color Science and Semantic Palettes**

Colors in the Brave design system exist simultaneously as base primitives and semantic aliases. The base primitives utilize both brand-specific hexadecimal values and grayscale steps. To clone the interface perfectly, the exact structural mapping of these dynamic variables must be respected. The interface uses a dynamic prefix system—specifically \--color-light- and \--color-dark-—which then feeds into an abstract semantic token, such as \--color-text-primary2.  
The brand identity relies on several key hexadecimal values that define the visual hierarchy, primarily focusing on variations of orange, blue-purple ("blurple"), and stark contrasting neutrals. Recent iterations of the interface have transitioned away from the legacy Brave orange in primary action buttons, replacing it with a modernized "blurple" tone across dialogs, infobars, and task managers6. The palette encompasses precise RGB and hexadecimal definitions that must be replicated without deviation.

| Brand Color Name | Hexadecimal Code | RGB Value | Usage Context within the Interface |
| :---- | :---- | :---- | :---- |
| **Brave Apricot** | \#E79364 | rgb(231, 147, 100\) | Primary brand accents, legacy primary actions, and visual highlights7. |
| **Brave Nutmeg** | \#874827 | rgb(135, 72, 39\) | Darkened brand accents, utilized for active and hover states on Apricot components7. |
| **Brave White** | \#FFFFFF | rgb(255, 255, 255\) | Foreground text in dark mode contexts, primary backgrounds in light mode contexts7. |
| **Alyssa** | \#785BAF | rgb(120, 91, 175\) | Extended palette accent, utilized in specific gradient transitions and marketing surfaces8. |
| **China Pink** | \#DF73AA | rgb(223, 115, 170\) | Extended palette accent for active state highlights8. |
| **Light Lime Green** | \#B6D871 | rgb(182, 216, 113\) | Positive confirmation states, success toasts, and verified publisher indicators8. |
| **Matte Sky Blue** | \#77B2CC | rgb(119, 178, 204\) | Secondary informational accents and subtle background highlights8. |

To implement this color science programmatically, the abstract variable must resolve dynamically. The primary text color, for example, is defined structurally as follows: \--color-light-text-primary evaluates to rgb(29, 31, 37), while \--color-dark-text-primary evaluates to rgb(236, 239, 242\)2. This abstraction is mapped across specialized cascading files based on the browser surface, such as variables-browser.css, variables-newtab.css, and variables-web3.css. This localized scoping allows individual products, like the New Tab Page or the Wallet, to inject specific overrides without disrupting the global styling environment1.

## **Typography, Iconography, and Rendering Nuances**

The primary typeface for the Brave interface is Poppins, a geometric sans-serif font selected for its high legibility and modern aesthetic2. While some localized operating system components or deep settings menus may fall back to system fonts—such as Inter on macOS or Roboto for Android components—the canonical desktop web UI relies heavily on Poppins10.  
The typography baseline for standard text is structured using combined font declarations to ensure strict vertical rhythm across all viewports. The baseline configuration enforces specific parameters that must be implemented identically to achieve visual parity.

| CSS Variable Identifier | Value | Architectural Purpose |
| :---- | :---- | :---- |
| \--typography-text-default-regular-font-size | 14px | Establishes the standard body text size for all primary reading surfaces2. |
| \--typography-text-default-regular-line-height | 20px | Dictates the standard body line height, ensuring adequate vertical whitespace2. |
| \--typography-text-default-regular-letter-spacing | 0 | Enforces default kerning without artificial tracking2. |
| \--typography-text-default-regular-paragraph-indent | 0 | Removes native indentation, relying purely on block margins2. |
| \--typography-text-default-regular-paragraph-spacing | 0 | Controlled externally via layout flex/grid gaps rather than text properties2. |
| \--font-text-default-regular | 400 14px/20px Poppins | Provides a combined shorthand declaration for rapid component styling2. |

A critical rendering nuance relates to anti-aliasing algorithms. Internal engineering documentation indicates that applying global WebKit font-smoothing indiscriminately via a wildcard selector (\* { \-webkit-font-smoothing: antialiased; }) causes severe visual degradation. Specifically, it forces text to appear excessively thin or "washed out" across critical surfaces like the bookmarks page, history panels, and internal Leo components11. To reconstruct this interface accurately, font-smoothing must be applied selectively at the component level rather than as a global reset, preserving the intended typographic weight of the Poppins font family.

## **Exact Pixel Calculation and Layout Mathematics**

A core requirement for replicating the Brave interface involves precise, mathematical pixel calculations to prevent anti-aliasing artifacts, blurry borders, and layout thrashing. The application operates across highly variable display environments, necessitating strict rules for bounding box alignment and device pixel ratio calculations.

### **Scaling Bounds and Sub-Pixel Rounding**

The implementation of horizontal tabs within the Chromium engine relies on a pixel-perfect rendering algorithm that scales and aligns bounding boxes to the nearest physical pixel. The core layout function in C++, ScaleAndAlignBounds, is designed to calculate dimensions that snap precisely to the pixel grid. The function shrinks the tab bounds by a predefined corner radius, scales the geometry from device-independent pixels (DIP) to physical pixels based on the display ratio, and mathematically rounds the X and Y coordinates using std::round12.  
A crucial detail of this exact pixel calculation is that the engine calculates the right edge explicitly rather than relying purely on a scalable width variable. This explicit right-edge calculation ensures that adjacent tabs meet with absolute precision during the painting phase, leaving no sub-pixel gaps or overlapping artifacts12. To replicate this in a web-based clone, engineers must avoid using fractional percentage widths for adjacent structural elements, opting instead for rigid pixel calculations (calc()) or strict Flexbox models that do not yield sub-pixel decimal widths.

### **Device Pixel Ratio (DPR) Integration**

To ensure graphical fidelity on high-density displays (such as Apple's Retina displays or high-DPI Android panels), the interface constantly polls the window.devicePixelRatio property. This read-only property returns the ratio of physical pixels to CSS pixels13. In instances where the UI utilizes HTML \<canvas\> elements for rendering complex charts (such as within the Brave Wallet portfolio view) or specific visual overlays, the backing store dimensions must be multiplied by this ratio. For instance, if window.devicePixelRatio returns 2, a canvas meant to display at 100x100 CSS pixels must be drawn at 200x200 physical pixels and scaled down via CSS to prevent blurriness13. Furthermore, specific browser configurations, such as Brave Shields' strict fingerprinting protection mode, may artificially spoof the window.devicePixelRatio to 1 or round it to the nearest integer to limit cross-site tracking entropy13. A cloned interface must account for this variable state gracefully, ensuring layouts do not shatter if the DPR is spoofed.

### **Mitigating Vector Graphics Padding Artifacts**

When rendering SVG iconography within defined CSS containers, a known browser layout anomaly occurs where a 3-pixel transparent (or black, depending on the format) buffer is artificially injected below the SVG element. This anomaly forces a 100x100 pixel container to render at 100x103 pixels, breaking strict vertical rhythms14. The 3-pixel variance appears tied to the baseline rendering of inline elements. To achieve exact pixel accuracy, the cloned UI must apply display: block or vertical-align: middle to all SVG icons to strip this ghost padding and maintain the rigid bounding boxes defined by the design tokens14.

## **Atomic Component Specifications**

A successful reproduction of the Brave interface necessitates an exact understanding of its atomic components, which manage interaction states, padding, and border radii.

### **Button Architecture and Interaction States**

The design system defines several primary button variants, each with distinct geometric rules. "Filled" buttons serve as primary actions, featuring a solid background. "Outline" buttons serve as secondary actions, featuring a transparent background with a visible stroke. "Plain" buttons serve as tertiary actions, inheriting text color with no default background. Finally, "Plain-faint" buttons are utilized for subdued tertiary actions, featuring adjusted opacity or fainter typography15.  
A critical architectural constraint exists regarding button heights. To ensure that filled buttons and outline buttons maintain absolutely identical bounding box heights—thereby preventing jarring layout thrashing when an outline button transitions to a filled state upon hover or activation—all standard buttons enforce a baseline 1-pixel transparent border. The source CSS logic is strictly defined as border: solid var(--border-width, 1px) var(--border-color, transparent);15. Attempting to implement a 0px border on filled components will result in a sub-pixel vertical misalignment, rendering the cloned interface visually inaccurate compared to the official client.  
Furthermore, a specific design nuance governs icon-only buttons, such as the "Close" button on customized dialogs or Brave News panels. Standard text buttons feature substantial horizontal and vertical padding. However, applying this default padding to icon-only variants utilizing the "plain" or "plain-faint" styles results in bloated, misaligned hover states that extend beyond the intended visual boundary15. The design specification dictates that these specific components must utilize a "hoverless" or stripped-padding variant to maintain precise geometric alignment within tight spaces15.

### **Viewport and Safe Area Management**

Modern UI engineering requires strict adherence to safe area insets to prevent content from bleeding under mobile notches, camera holes, or bottom gesture navigation bars (the "chin"). The cloned interface must implement dynamic environmental variables to bound the application safely. This is achieved by mapping the padding properties to the env() function: padding-top: env(safe-area-inset-top); and equivalently for the left, right, and bottom properties16.  
Additionally, for panels like the Wallet or the Shields dropdown that must remain perfectly bounded within the visible screen area without triggering internal scrollbars when the operating system's address bar expands or collapses, the layout must utilize Small Viewport Height (svh) units17. This ensures the UI recalculates its bounds instantly, preventing bottom-anchored content from being temporarily obscured.

## **Macro-UI: The Browser Chrome and Tab Strip**

The browser chrome—the encompassing window frame, tab strip, and toolbars—represents the most highly engineered aspect of the application. Replicating this requires managing competing layout paradigms, specifically the distinction between horizontal and vertical tab architectures.

### **Vertical Tab Geometry and Expansion Logic**

The implementation of vertical tabs introduces a distinct spatial paradigm designed to address horizontal overcrowding, offering a two-dimensional view that maintains legible tab titles regardless of the sheer number of open pages18.  
To clone the vertical tab behavior accurately, several strict specifications must be met. First, when collapsed, the vertical tab strip acts as an icon-only sidebar. Hovering near the left edge must trigger an auto-expand animation, smoothly revealing the full titles of the tabs19. Second, during these state animations, the favicon icons within the tabs must not flicker or reposition erratically. Transitions must be strictly applied to the container width and text opacity, maintaining the absolute rendering stability of the icon layer4. Third, a true vertical tab implementation must remove the redundant top horizontal space, pulling the omnibox and toolbar up to the absolute top of the window edge, while carefully accounting for native operating system window controls, such as macOS traffic lights19. The interface also supports an immersive fullscreen feature on macOS, which requires specific CSS handling to prevent the rendering of a blank title bar or extra borders around the content area when vertical tabs are active4.

### **Horizontal Tab Scrolling**

For users utilizing the traditional horizontal layout, the interface previously suffered from an issue where tabs would shrink to a width of merely 3 pixels when overcrowded, rendering them entirely illegible and unclickable20. To solve this, a brave-scrollable-tab-strip flag was introduced, fundamentally altering the flexbox behavior of the tab strip. In a cloned interface, horizontal tabs must enforce a strict min-width property. Once the container capacity is exceeded, the tabs must not shrink further; instead, the parent container must switch to overflow-x: scroll (or a hidden scrollbar with arrow navigation), allowing the user to pan horizontally across full-width tabs20.

### **The Omnibox, Sidebar, and App Menu**

The toolbar area is heavily customizable via a side panel accessed from the appearance settings. Rebuilding this requires implementing a modular layout where action icons (such as the Brave Wallet, Brave Rewards, and Web3 extensions) can be dynamically reordered or hidden21. The left-aligned primary sidebar provides access to distinct workspaces. When integrating this, developers must recognize that pinned web apps or specific contexts in the sidebar often maintain separate session states, functioning independently from the main browser tabs like a segmented mini-browser session22.  
The main browser application menu (accessed via the "hamburger" icon) is constructed with precise semantic separators. The structure relies on specific insertion rules, indexing the "More Tools" submenu followed by Bookmarks, Downloads, and Extensions23. Separators are strictly categorized into types such as ui::SPACING\_SEPARATOR, ui::LOWER\_SEPARATOR, and ui::UPPER\_SEPARATOR23. To replicate this visually in HTML and CSS, the menu must utilize horizontal rules (\<hr\>) with explicitly defined top and bottom margins mapped to the Leo spacing tokens, ensuring the visual rhythm matches the C++ native implementation perfectly.

## **The Brave Shields Interface: A Case Study in Stateful UI**

The Brave Shields menu serves as the primary security interface and underwent a massive redesign to align with the Leo design system, drastically improving accessibility and contrast9. Replicating this component requires complex state management and precise CSS animations.

### **The Accordion Structure**

The modern Shields interface abandons the older "Simple/Advanced" distinct views in favor of an "Advanced controls" accordion element. The closed state functions as the default view, displaying basic blocking metrics and the main active/inactive toggle. The open state expands vertically to reveal highly granular controls for cross-site trackers, scripts, cookies, and fingerprinting parameters9. Crucially, the accordion must remember its open or closed state globally, writing this preference to local storage so that it remains persistent across all future browsing sessions9.

### **The Looping Gradient Toggle**

The most visually complex element in the Shields panel is the main active state toggle. It does not utilize a static background color. Instead, it features a continuous, looping linear-gradient that transitions smoothly through a highly specific color array using a 2-millisecond loop sequence with a linear ease9.  
The exact color stops required to replicate this gradient are defined as follows:

1. rgba(255,167,59,1) (Hex: \#FFA73B)  
2. rgba(255,118,84,1) (Hex: \#FF7654)  
3. rgba(251,84,43,1) (Hex: \#FB542B)  
4. rgba(247,36,28,1) (Hex: \#F7241C)  
5. rgba(252,79,130,1) (Hex: \#FC4F82)  
6. The sequence loops back to rgba(255,167,59,1)9.

The background animation logic cycles seamlessly across a 120-degree angle, rendering a highly polished, organic flow indicating active protection9. Rebuilding this requires a CSS @keyframes animation that smoothly shifts the background-position of an oversized linear gradient (e.g., background-size: 200% 200%) back and forth along the defined axis.

### **Exact Copywriting and Typography**

The precise textual layout within the Shields panel is critical for a fully authentic clone. The font style is entirely Poppins. The educational and interactive phrasing must be replicated exactly as dictated by the design specifications. For example, instead of legacy phrasing, the interface must read: *"If this site seems broken, try Shields down. Note: this may reduce Brave privacy protections."*9. The button responsible for reporting issues must be labeled exactly *"Report site broken"*9. Furthermore, the educational copy embedded within the advanced panel states: *"Sites often have cookies and scripts lurking in the background, trying to identify you and your device. Why? So you can be followed around the web, your activity tracked on every site you visit. Brave Shields block cookies and scripts, which means better privacy online."*9. To replicate the user experience perfectly, ensure that any draggable elements within the customizable lists support full keyboard navigation: the space bar must pick up the item, arrow keys move it, and a second space bar press drops it into place24.

## **New Tab Page (NTP) and Dashboard Customization**

The New Tab Page operates as a highly personalized dashboard and requires a robust background rendering system capable of handling multiple media types simultaneously25.  
To clone the NTP, the developer must implement several background logic pathways. Users must be able to select from a predefined list of solid colors and CSS gradients25. The system must also support local image uploads, including the ability to upload an array of multiple files that shuffle randomly upon each new tab load25.  
The most complex logic governs the "Sponsored Images" toggle, which is located at the top level under Customize Dashboard \> Background images25. This toggle operates entirely independently of whether the user has a custom color, gradient, or personal image selected25. The logic flow is highly specific: if the user has Brave Rewards disabled, interacting with the sponsored image toggle must not activate it immediately. Instead, it must render a prompt button reading *"Start using Rewards"*25. Clicking this button initiates a secondary onboarding tutorial modal. Once the user is successfully onboarded, returning to the toggle hides the onboarding button and replaces it with static informational text confirming that the user is now earning tokens for viewing sponsored imagery25.  
The NTP layout features a default number of top site tiles set precisely to 7, and the integrated 12-hour clock widget must display the AM/PM indicator explicitly4. Care must be taken regarding the Z-index of these components; a known architectural bug previously allowed hidden elements, such as background customization controls, to be accidentally clickable when the central search widget held focus. The cloned CSS must strictly enforce pointer-events: none on hidden layout layers4.

## **Web3 Wallet and Privacy Analytics Interfaces**

The Web3 implementation, known as the Brave Wallet, utilizes specialized CSS scopes via the variables-web3.css tokens1. Replicating this interface requires meticulous attention to data density, alignment, and border geometry.  
The wallet navigation and the interior card bodies must be strictly center-aligned across the horizontal axis26. Recent design audits have strictly updated the border radii for specific components, meaning the cloned interface must apply specific corner rounding to the Portfolio action buttons (Buy, Send, Swap, and Deposit), the Segmented Controls, and the DApp Connection Settings buttons26. The interface prioritizes native assets, ensuring they are pinned to the top of the "Select Token" modal4. Furthermore, when displaying lengthy RPC URLs within the "Add" and "Switch" network panels, the text must wrap cleanly using word-wrap: break-word to prevent horizontal overflow from shattering the modal container4. The token transaction screens (Send and Swap) require a dynamic token background that adjusts its primary color based on the active asset being transacted26. Finally, all fetched cryptocurrency prices must include a contextual tooltip on hover indicating the "Last updated" timestamp4.  
The P3A (Privacy-Preserving Product Analytics) onboarding interface highlights how the system manages stateful privacy components. The design requires an initial welcome screen featuring a checkbox before the main privacy onboarding experience begins. For new users, if the notice is viewed, internal application states update p3a.enabled to true and p3a.notice\_acknowledged to true. If the user taps the checkbox to unselect it, p3a.enabled flips to false10. The checkbox itself must strictly adhere to the Figma specification, matching the precise Leo color and style parameters, though it is permitted to use the Roboto font exclusively on Android surfaces to match native OS expectations10.

## **Conclusion**

The Brave Browser user interface is a sophisticated amalgamation of native Chromium rendering logic and a highly portable, token-driven web design system. Rebuilding this interface to a pixel-perfect standard requires moving beyond superficial CSS styling and embracing the underlying mathematical and architectural methodology.  
By establishing a robust token pipeline, respecting Chromium's exact sub-pixel scaling geometry, implementing the precise 2-millisecond gradient loops and hoverless button variants, and adopting modular viewport units to manage safe areas, developers can construct a digital clone that not only looks visually identical but functions with the identical spatial stability and theme fluidity that defines the official application.

#### **Works cited**

1. leo/AGENTS.md at main · brave/leo \- GitHub, [https://github.com/brave/leo/blob/main/AGENTS.md](https://github.com/brave/leo/blob/main/AGENTS.md)  
2. brave/leo: Design tokens for the Brave's design system known as Leo \- GitHub, [https://github.com/brave/leo](https://github.com/brave/leo)  
3. README.md \- brave/leo \- GitHub, [https://github.com/brave/leo/blob/main/README.md](https://github.com/brave/leo/blob/main/README.md)  
4. brave-browser/CHANGELOG\_DESKTOP.md at master \- GitHub, [https://github.com/brave/brave-browser/blob/master/CHANGELOG\_DESKTOP.md](https://github.com/brave/brave-browser/blob/master/CHANGELOG_DESKTOP.md)  
5. UI Color Themes · brave/brave-browser Wiki \- GitHub, [https://github.com/brave/brave-browser/wiki/UI-Color-Themes](https://github.com/brave/brave-browser/wiki/UI-Color-Themes)  
6. Update button colors and style to the latest Nala design sytem · Issue \#37970 \- GitHub, [https://github.com/brave/brave-browser/issues/37970](https://github.com/brave/brave-browser/issues/37970)  
7. BRAVE Logo & Brand Assets (SVG, PNG and vector) \- Brandfetch, [https://brandfetch.com/thebrave.io](https://brandfetch.com/thebrave.io)  
8. Brave New World Color Scheme \- Palettes \- SchemeColor.com, [https://www.schemecolor.com/brave-new-world.php](https://www.schemecolor.com/brave-new-world.php)  
9. Apply Brave design system components to Shields \#16654 \- GitHub, [https://github.com/brave/brave-browser/issues/16654](https://github.com/brave/brave-browser/issues/16654)  
10. Implement onboarding for P3A on Android · Issue \#12723 · brave/brave-browser \- GitHub, [https://github.com/brave/brave-browser/issues/12723](https://github.com/brave/brave-browser/issues/12723)  
11. Release Channel 1.90.122 : r/brave\_browser \- Reddit, [https://www.reddit.com/r/brave\_browser/comments/1tc9ke4/release\_channel\_190122/](https://www.reddit.com/r/brave_browser/comments/1tc9ke4/release_channel_190122/)  
12. chrome/browser/ui/views/tabs/tab.cc \- chromium/src \- Git at Google, [https://chromium.googlesource.com/chromium/src/+/fd44237deff45b5e048ac6178c1081df57e9b04f/chrome/browser/ui/views/tabs/tab.cc](https://chromium.googlesource.com/chromium/src/+/fd44237deff45b5e048ac6178c1081df57e9b04f/chrome/browser/ui/views/tabs/tab.cc)  
13. devicePixelRatio: Browser Support, Use Cases, Limits | TestMu AI (Formerly LambdaTest), [https://www.testmuai.com/learning-hub/devicepixelratio-browser-support/](https://www.testmuai.com/learning-hub/devicepixelratio-browser-support/)  
14. 3 pixel padding rendered below SVG (Chrome). · Issue \#51 · tsayen/dom-to-image \- GitHub, [https://github.com/tsayen/dom-to-image/issues/51](https://github.com/tsayen/dom-to-image/issues/51)  
15. Squircle looks bad on our plain/plain-faint buttons with a background hover · Issue \#669 · brave/leo \- GitHub, [https://github.com/brave/leo/issues/669](https://github.com/brave/leo/issues/669)  
16. Chrome on Android edge-to-edge migration guide | CSS and UI \- Chrome for Developers, [https://developer.chrome.com/docs/css-ui/edge-to-edge](https://developer.chrome.com/docs/css-ui/edge-to-edge)  
17. Polypane 26: Accurate device emulation with safe area and small viewport units, [https://polypane.app/blog/polypane-26-accurate-device-emulation-with-safe-area-and-small-viewport-units/](https://polypane.app/blog/polypane-26-accurate-device-emulation-with-safe-area-and-small-viewport-units/)  
18. Brave Browser introduces vertical tabs \- Hacker News, [https://news.ycombinator.com/item?id=36154692](https://news.ycombinator.com/item?id=36154692)  
19. FEATURE REQUEST : Vertical Tabs & Hide Title bar : r/brave\_browser \- Reddit, [https://www.reddit.com/r/brave\_browser/comments/okw0gt/feature\_request\_vertical\_tabs\_hide\_title\_bar/](https://www.reddit.com/r/brave_browser/comments/okw0gt/feature_request_vertical_tabs_hide_title_bar/)  
20. Brave 1.86 no longer has flags for tab scrolling, is there a way to bring them back? \- Reddit, [https://www.reddit.com/r/brave\_browser/comments/1qeedvo/brave\_186\_no\_longer\_has\_flags\_for\_tab\_scrolling/](https://www.reddit.com/r/brave_browser/comments/1qeedvo/brave_186_no_longer_has_flags_for_tab_scrolling/)  
21. Add \`Themes and colors\` and \`Toolbar\` side panels · Issue \#39375 · brave/brave-browser, [https://github.com/brave/brave-browser/issues/39375](https://github.com/brave/brave-browser/issues/39375)  
22. Enhance Brave Sidebar Functionality (Like Edge Sidebar) · Issue \#45831 \- GitHub, [https://github.com/brave/brave-browser/issues/45831](https://github.com/brave/brave-browser/issues/45831)  
23. brave-core/browser/ui/toolbar/brave\_app\_menu\_model.cc at master \- GitHub, [https://github.com/brave/brave-core/blob/master/browser/ui/toolbar/brave\_app\_menu\_model.cc](https://github.com/brave/brave-core/blob/master/browser/ui/toolbar/brave_app_menu_model.cc)  
24. Shields v2 UI Refresh · Issue \#18630 · brave/brave-browser \- GitHub, [https://github.com/brave/brave-browser/issues/18630](https://github.com/brave/brave-browser/issues/18630)  
25. custom background for NTP · Issue \#15252 · brave/brave-browser \- GitHub, [https://github.com/brave/brave-browser/issues/15252](https://github.com/brave/brave-browser/issues/15252)  
26. Release Channel 1.64.109 \- Release Notes \- Brave Community, [https://community.brave.app/t/release-channel-1-64-109/538636](https://community.brave.app/t/release-channel-1-64-109/538636)