-- Safari Actions Library for WindowLLM Testing
-- Provides reusable handlers for Safari/extension interactions

-- Click the WindowLLM extension icon in Safari's toolbar
on clickExtensionIcon()
    tell application "System Events"
        tell process "Safari"
            try
                -- Find WindowLLM button in toolbar
                set toolbarButtons to buttons of toolbar 1 of window 1
                repeat with btn in toolbarButtons
                    try
                        if description of btn contains "WindowLLM" or name of btn contains "WindowLLM" then
                            click btn
                            return true
                        end if
                    end try
                end repeat

                -- Try alternate: look for extension buttons group
                set extGroup to group "Extensions" of toolbar 1 of window 1
                set extButtons to buttons of extGroup
                repeat with btn in extButtons
                    try
                        if description of btn contains "WindowLLM" then
                            click btn
                            return true
                        end if
                    end try
                end repeat
            on error errMsg
                log "clickExtensionIcon error: " & errMsg
            end try
        end tell
    end tell
    return false
end clickExtensionIcon

-- Grant consent in the extension popover
on grantConsentInPopup()
    tell application "System Events"
        tell process "Safari"
            delay 0.5
            try
                -- Find the popover (extension popup)
                set popoverWindow to pop over 1 of window 1

                -- Look for grant/allow button
                set allButtons to buttons of popoverWindow
                repeat with btn in allButtons
                    set btnName to name of btn
                    if btnName contains "Grant" or btnName contains "Allow" or btnName contains "Approve" then
                        click btn
                        return true
                    end if
                end repeat
            on error errMsg
                log "grantConsentInPopup error: " & errMsg
            end try
        end tell
    end tell
    return false
end grantConsentInPopup

-- Deny consent in the extension popover
on denyConsentInPopup()
    tell application "System Events"
        tell process "Safari"
            delay 0.5
            try
                set popoverWindow to pop over 1 of window 1
                set allButtons to buttons of popoverWindow
                repeat with btn in allButtons
                    set btnName to name of btn
                    if btnName contains "Deny" or btnName contains "Cancel" or btnName contains "Block" then
                        click btn
                        return true
                    end if
                end repeat
            on error errMsg
                log "denyConsentInPopup error: " & errMsg
            end try
        end tell
    end tell
    return false
end denyConsentInPopup

-- Enter passphrase in unlock popup
on enterPassphraseInPopup(passphrase)
    tell application "System Events"
        tell process "Safari"
            delay 0.5
            try
                set popoverWindow to pop over 1 of window 1

                -- Find password field
                set passwordField to text field 1 of popoverWindow
                set focused of passwordField to true
                set value of passwordField to passphrase
                delay 0.2

                -- Click unlock button
                set allButtons to buttons of popoverWindow
                repeat with btn in allButtons
                    set btnName to name of btn
                    if btnName contains "Unlock" then
                        click btn
                        return true
                    end if
                end repeat
            on error errMsg
                log "enterPassphraseInPopup error: " & errMsg
            end try
        end tell
    end tell
    return false
end enterPassphraseInPopup

-- Open extension options/settings page
on openExtensionOptions()
    tell application "Safari"
        activate
        delay 0.5
    end tell

    tell application "System Events"
        tell process "Safari"
            -- Open Safari Preferences
            keystroke "," using command down
            delay 1

            try
                -- Click Extensions tab
                tell window 1
                    click button "Extensions" of toolbar 1
                end tell
                delay 0.5

                -- Find and select WindowLLM
                tell window 1
                    set extensionList to outline 1 of scroll area 1 of group 1 of group 1
                    set extensionRows to rows of extensionList

                    repeat with r in extensionRows
                        try
                            if name of UI element 1 of r contains "WindowLLM" then
                                select r
                                delay 0.3
                                return true
                            end if
                        end try
                    end repeat
                end tell
            on error errMsg
                log "openExtensionOptions error: " & errMsg
            end try
        end tell
    end tell
    return false
end openExtensionOptions

-- Navigate Safari to a URL
on navigateToURL(theURL)
    tell application "Safari"
        activate
        try
            if (count of windows) is 0 then
                make new document with properties {URL:theURL}
            else
                set URL of document 1 to theURL
            end if
            return true
        on error errMsg
            log "navigateToURL error: " & errMsg
            return false
        end try
    end tell
end navigateToURL

-- Execute JavaScript in current Safari page and return result
on executeJavaScript(jsCode)
    tell application "Safari"
        try
            set result to do JavaScript jsCode in document 1
            return result
        on error errMsg
            return "ERROR: " & errMsg
        end try
    end tell
end executeJavaScript

-- Wait for a JavaScript condition to be true
on waitForCondition(jsCondition, maxSeconds)
    set waited to 0
    repeat while waited < maxSeconds
        tell application "Safari"
            try
                set result to do JavaScript jsCondition in document 1
                if result is true then
                    return true
                end if
            end try
        end tell
        delay 1
        set waited to waited + 1
    end repeat
    return false
end waitForCondition

-- Close current Safari window/tab
on closeCurrentTab()
    tell application "Safari"
        try
            close document 1
            return true
        on error
            return false
        end try
    end tell
end closeCurrentTab
