#!/bin/bash
# Startup script for G4F OpenAI-Compatible API

echo "Installing requirements..."
pip install -r requirements.txt

echo "Starting G4F OpenAI-Compatible API server..."
python app.py