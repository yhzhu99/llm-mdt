#!/bin/bash

echo "Starting LLM MDT frontend..."
echo ""
echo "Frontend: http://localhost:5173"
echo ""

cd frontend || exit 1
npm run dev
