"use client"

import React from "react"
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faCaretRight, faDownload } from "@fortawesome/free-solid-svg-icons"

export default function ExportConfigDialog({ jsonString }: { jsonString: string }) {

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "config.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog>
      <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
        <FontAwesomeIcon icon={faDownload} />
        <p className="text-left">Export Your Config</p>
        <FontAwesomeIcon icon={faCaretRight} />
      </DialogTrigger>

      <DialogContent className="frosted text-foreground">
        <DialogHeader>
          <DialogTitle>Export Config</DialogTitle>
        </DialogHeader>

        <pre className="bg-gray-900 p-4 rounded text-sm overflow-auto max-h-96">
          {JSON.stringify(JSON.parse(jsonString), null, 2)}
        </pre>


        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          <Button onClick={handleDownload}>Download JSON</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
