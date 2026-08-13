#!/bin/bash

# List the current directory and pipe the output to grep
ls -l | grep "\.txt$" > found.txt

# Print the contents of found.txt
cat found.txt