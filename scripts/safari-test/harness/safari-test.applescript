-- Safari Test Runner
-- Navigates to test URL, waits for tests to complete, and extracts results

on run argv
    set testUrl to item 1 of argv
    set resultsFile to "/tmp/safari-test-results.json"

    tell application "Safari"
        activate
        delay 0.5

        -- Open new window/tab with test URL
        if (count of windows) is 0 then
            make new document with properties {URL:testUrl}
        else
            make new document with properties {URL:testUrl}
        end if
        delay 3

        -- Wait for page to load
        set maxLoadWait to 30
        set loadWait to 0
        repeat while loadWait < maxLoadWait
            try
                set readyState to do JavaScript "document.readyState" in document 1
                if readyState is "complete" then
                    exit repeat
                end if
            end try
            delay 1
            set loadWait to loadWait + 1
        end repeat

        -- Wait for window.llm to be defined (extension injection)
        set maxLLMWait to 30
        set llmWait to 0
        repeat while llmWait < maxLLMWait
            try
                set hasLLM to do JavaScript "typeof window.llm !== 'undefined'" in document 1
                if hasLLM then
                    exit repeat
                end if
            end try
            delay 1
            set llmWait to llmWait + 1
        end repeat

        if llmWait >= maxLLMWait then
            -- window.llm not available - write error result
            set errorResult to "[{\"name\":\"extension:injection\",\"status\":\"fail\",\"error\":\"window.llm not injected by extension\"}]"
            do shell script "echo " & quoted form of errorResult & " > " & quoted form of resultsFile
            close document 1
            return
        end if

        -- Wait for tests to complete (poll __testsDone)
        set maxWait to 120
        set waited to 0
        repeat while waited < maxWait
            try
                set isDone to do JavaScript "window.__testsDone === true" in document 1
                if isDone then
                    exit repeat
                end if
            end try
            delay 1
            set waited to waited + 1
        end repeat

        -- Extract results
        set testResults to "[]"
        try
            set testResults to do JavaScript "JSON.stringify(window.__testResults || [])" in document 1
        on error errMsg
            set testResults to "[{\"name\":\"results:extraction\",\"status\":\"fail\",\"error\":\"" & errMsg & "\"}]"
        end try

        -- Write results to file
        do shell script "echo " & quoted form of testResults & " > " & quoted form of resultsFile

        -- Close test window
        close document 1
    end tell
end run
