# Remove the output file if it already exists
Remove-Item .\my_prompt.txt -ErrorAction SilentlyContinue

# Collect all files tracked by Git or otherwise not ignored per .gitignore
# This returns relative paths, one per line.
$trackedAndUnignored = git ls-files --cached --others --exclude-standard

# Convert each path to a FileInfo object (skip any path that doesn't exist)
$allFiles = foreach ($path in $trackedAndUnignored) {
    if (Test-Path $path) {
        Get-Item $path
    }
}

# Separate README files from everything else
$readmeFiles = $allFiles | Where-Object { $_.Name -match '^README(\.txt|\.md)?$' }
$regularFiles = $allFiles | Where-Object { $_.Name -notmatch '^README(\.txt|\.md)?$' }

# Helper function to write file info & content
function Write-FileContent {
    param(
        [System.IO.FileInfo]$File
    )
    Add-Content .\my_prompt.txt "+++++++++++++"
    Add-Content .\my_prompt.txt "File Name: $($File.Name)"
    Add-Content .\my_prompt.txt "Full Path: $($File.FullName)"
    Get-Content $File.FullName | Add-Content .\my_prompt.txt
    Add-Content .\my_prompt.txt "File Name: $($File.Name)"
    Add-Content .\my_prompt.txt "--------------------"
    Add-Content .\my_prompt.txt ""  # Blank line for readability
}

# Write non-README files first
foreach ($file in $regularFiles) {
    Write-FileContent -File $file
}

# Append README files last
foreach ($file in $readmeFiles) {
    Write-FileContent -File $file
}
