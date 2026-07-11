-- Enable WindowLLM extension in Safari Preferences
-- This script automates enabling the extension via Safari's UI

tell application "Safari"
    activate
    delay 1
end tell

tell application "System Events"
    tell process "Safari"
        -- Open Safari Preferences (Settings on newer macOS)
        keystroke "," using command down
        delay 1.5

        -- Click Extensions tab in toolbar
        tell window 1
            try
                click button "Extensions" of toolbar 1
            on error
                -- Try alternate UI structure for different macOS versions
                click button "Extensions" of group 1 of toolbar 1
            end try
        end tell
        delay 1

        -- Find and enable WindowLLM extension
        tell window 1
            try
                -- Look for WindowLLM in the extensions list (sidebar)
                set extensionList to outline 1 of scroll area 1 of group 1 of group 1
                set extensionRows to rows of extensionList

                repeat with r in extensionRows
                    try
                        set rowName to name of UI element 1 of r
                        if rowName contains "WindowLLM" then
                            -- Select the extension row
                            select r
                            delay 0.3

                            -- Click checkbox to enable if not already enabled
                            set cb to checkbox 1 of r
                            if value of cb is 0 then
                                click cb
                                delay 0.5
                            end if
                            exit repeat
                        end if
                    end try
                end repeat
            on error errMsg
                -- Log error but continue
                log "Error finding extension: " & errMsg
            end try
        end tell
        delay 0.5

        -- Close preferences window
        keystroke "w" using command down
    end tell
end tell
