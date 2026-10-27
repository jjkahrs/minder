# Minder
Minder is a web app that:
* provides visibility into currently running claude code agents and subagents.
* has hook event sounds that can be customized and toggled on/off
* Provides stylized visualization of current states of agents and subagents

# Color Pallete
Primary Background - #0A0D14 - Main app background, base canvas, card surfaces
Secondary Surface - #121824 - Panels, modal boxes, inactive containers, sidebars
Primary Accent / Glow - #73fffe - Active states, primary buttons, interactive cursors
Secondary Accent - #6287f8 - Data graphs, secondary links, progress bars
Muted Structure - #383e65 - Grid lines, borders, disabled text, structural frames
Warning / Alert - #ff6e21 - System warnings, critical alerts, error states
Text / Readout - #e2f1f8 - Primary typography, headers, numeric readouts

# Typography
* Typefaces: Geometric sans-serifs, condensed technical fonts, or monospaced/CRT styles (e.g., Courier Prime, Square Sans).
* Hierarchy: Use all-caps with wide letter-spacing (tracking-widest) for headers, tags, and coordinates; clean readable weights for data logs.

# UI Primitives and Components
* Corner Brackets: Wrap frames in L-shaped geometric corners instead of standard boxed borders.
* Data Visualization: Minimalist linear graphs, radial progress rings, target reticles, and ticking numerical counters.

# General Style Guidelines
* Motion & Feedback: Use subtle floating, glitch, or fade-in transitions (via tools like Framer Motion or CSS keyframes), keeping animations fast (under 200ms) so the UI feels responsive rather than sluggish.
* Layering & Asymmetry: Break away from standard web card grids; use off-center radar sweeps, floating sub-panels, and overlapping technical overlays
