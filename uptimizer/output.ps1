# Remove the output file if it already exists
Remove-Item .\my_prompt.txt -ErrorAction SilentlyContinue

# Gather all files from the current directory (recursively)
$allFiles = Get-ChildItem -Path . -File -Recurse

# Separate files into two groups: everything except README, and README files
$readmeFiles   = $allFiles | Where-Object { $_.Name -match '^README(\.txt|\.md)?$' }
$regularFiles  = $allFiles | Where-Object { $_.Name -notmatch '^README(\.txt|\.md)?$' }

# Function to write file info and content
function Write-FileContent {
    param (
        [System.IO.FileInfo]$File
    )
    Add-Content .\my_prompt.txt "===================================="
    Add-Content .\my_prompt.txt "File Name: $($File.Name)"
    Add-Content .\my_prompt.txt "Full Path: $($File.FullName)"
    Add-Content .\my_prompt.txt "---------- FILE CONTENT START ------"
    Get-Content $File.FullName | Add-Content .\my_prompt.txt
    Add-Content .\my_prompt.txt "---------- FILE CONTENT END --------"
    Add-Content .\my_prompt.txt "" # Blank line for spacing
}

# Write out all non-README files first
foreach ($file in $regularFiles) {
    Write-FileContent -File $file
}

# Finally, append README files at the bottom
foreach ($readme in $readmeFiles) {
    Write-FileContent -File $readme
}
