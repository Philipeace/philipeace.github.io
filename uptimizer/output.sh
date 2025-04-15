#!/usr/bin/env bash

# Remove the output file if it exists
rm -f my_prompt.txt

# Collect all files tracked by Git or otherwise not ignored per .gitignore
# This returns a list of relative paths (one per line).
tracked_and_unignored=$(git ls-files --cached --others --exclude-standard)

# Separate readme vs. regular files
readme_files=()
regular_files=()

for f in $tracked_and_unignored; do
    # If file doesn't actually exist on disk, skip it
    [ -f "$f" ] || continue

    base="$(basename "$f")"
    if [[ $base =~ ^README(\.txt|\.md)?$ ]]; then
        readme_files+=("$f")
    else
        regular_files+=("$f")
    fi
done

# Helper function to write file info & content
write_file_content() {
    local file="$1"
    # Resolve the full path in a cross-platform-friendly manner
    local full_path
    full_path="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"

    echo "+++++++++++++" >> my_prompt.txt
    echo "File Name: $(basename "$file")" >> my_prompt.txt
    echo "Full Path: $full_path" >> my_prompt.txt
    cat "$file" >> my_prompt.txt
    echo "File Name: $(basename "$file")" >> my_prompt.txt
    echo "--------------------" >> my_prompt.txt
    echo "" >> my_prompt.txt
}

# Write non-README files first
for file in "${regular_files[@]}"; do
    write_file_content "$file"
done

# Append README files last
for file in "${readme_files[@]}"; do
    write_file_content "$file"
done
