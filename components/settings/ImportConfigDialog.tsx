import {
    Dialog,
    DialogContent,
    DialogClose,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { Button } from "@/components/ui/button"
import { faCaretRight, faUpload } from "@fortawesome/free-solid-svg-icons"

export default function ImportConfigDialog() {
    const handleUpload = () => {

    }

    return (
        <Dialog>
            <DialogTrigger className="grid grid-cols-subgrid border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md">
                    <FontAwesomeIcon icon={faUpload} />
                    <p className="text-left">Import Another Config</p>
                <FontAwesomeIcon icon={faCaretRight} />
            </DialogTrigger>

            <DialogContent className="frosted text-(--text-primary)">
                <DialogHeader>
                    <DialogTitle>Import Config</DialogTitle>
                </DialogHeader>

                <pre className="bg-gray-900 p-4 rounded text-sm overflow-auto max-h-96">
                    // TODO: display imported config file
                </pre>


                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                    <Button onClick={handleUpload}>Upload JSON</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}