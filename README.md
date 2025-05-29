# Instagram Mass Follow/Unfollow Chrome Extension

A powerful and user-friendly Chrome extension for automating follow and unfollow actions on Instagram, with built-in safety features and customizable settings.

## Features

- **Mass Follow/Unfollow Automation**: Automate follow and unfollow actions on Instagram with customizable settings
- **Smart Rate Limiting**: Built-in delays and batch processing to avoid Instagram's detection
- **Safety Controls**: Configurable daily limits and pause periods between actions
- **Real-time Status Updates**: Visual feedback on the automation progress
- **User-friendly Interface**: Clean, modern UI with Linear App inspired aesthetics
- **Error Handling**: Robust error detection and handling for various Instagram scenarios

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory

## Usage

1. Navigate to any Instagram page (e.g., followers/following list)
2. Click the extension icon in your Chrome toolbar
3. Configure your settings:
   - Choose between Follow or Unfollow mode
   - Set action intervals (min/max seconds between actions)
   - Set actions per batch
   - Set daily limit
   - Configure pause duration between batches
4. Click "Start" to begin automation
5. Monitor progress through the status indicators
6. Click "Stop" at any time to halt automation

## Settings

### Action Settings
- **Action Type**: Choose between Follow or Unfollow
- **Interval**: Time between actions (2-10 seconds recommended)
- **Actions per Batch**: Number of actions before pausing (10-50 recommended)
- **Daily Limit**: Maximum actions per day (100-500 recommended)

### Safety Settings
- **Pause Between Batches**: Rest period between action batches (5-10 minutes recommended)
- **Random Delays**: Built-in randomization to mimic human behavior

## Safety Features

- **Rate Limiting**: Prevents too many actions in a short time
- **Action Blocking Detection**: Automatically stops if Instagram blocks actions
- **Error Recovery**: Handles various error scenarios gracefully
- **Session Tracking**: Keeps track of processed users to avoid duplicates
- **Visual Feedback**: Clear status indicators for each action

## Technical Details

### Files Structure
- `manifest.json`: Extension configuration
- `content_script.js`: Core automation logic
- `popup.html/js/css`: User interface
- `background.js`: Background process management
- `styles.css`: Visual feedback styles

### Dependencies
- Chrome Extension Manifest V3
- No external dependencies required

## Limitations

- Works only on Instagram web interface
- Requires manual navigation to target pages
- Subject to Instagram's rate limiting and anti-automation measures
- May need updates if Instagram changes their UI

## Contributing

Feel free to submit issues and enhancement requests!

## Disclaimer

This extension is for educational purposes only. Use responsibly and in accordance with Instagram's terms of service. The developers are not responsible for any account restrictions or bans that may result from using this extension.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 