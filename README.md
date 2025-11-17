# Region Screenshot (Chrome Extension)

Select a portion of the current page and save a cropped screenshot to your Downloads folder.

## Install (Load Unpacked)

1. Open Chrome and go to `chrome://extensions/`
2. Toggle on "Developer mode" (top-right)
3. Click "Load unpacked"
4. Select the folder `GraphReaderExtension` (this project directory)

You should now see the "Region Screenshot" extension in your toolbar (puzzle icon). Pin it for quick access if you like.

## Usage

- Click the toolbar button "Region Screenshot"
- Your cursor becomes a crosshair on the current tab
- Click and drag to select a rectangle
- Release the mouse to capture; the cropped image is saved automatically to Downloads
- Press `Esc` to cancel

Notes:
- The capture is of the visible area of the tab only
- The extension accounts for device pixel ratio and page zoom for crisp crops

## Permissions

- `activeTab`: allow script execution on the active tab after you click the action
- `scripting`: programmatically inject the content script
- `downloads`: save the cropped image
- `tabs`: capture the visible part of the tab

## Files

- `manifest.json`: MV3 manifest
- `background.js`: service worker that injects the content script, captures screenshots, and saves files
- `contentScript.js`: selection overlay, crop logic, and messaging


