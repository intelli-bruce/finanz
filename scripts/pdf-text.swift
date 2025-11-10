#!/usr/bin/env swift
import Foundation
import PDFKit

let args = CommandLine.arguments
if args.count < 2 {
    fputs("Usage: pdf-text.swift <file>\n", stderr)
    exit(1)
}

let filePath = args[1]
let url = URL(fileURLWithPath: filePath)

guard let document = PDFDocument(url: url) else {
    fputs("Failed to open PDF: \(filePath)\n", stderr)
    exit(2)
}

for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    let header = "\n<<<PAGE \(index + 1)>>>\n"
    print(header)
    let text = page.string ?? ""
    print(text)
}
