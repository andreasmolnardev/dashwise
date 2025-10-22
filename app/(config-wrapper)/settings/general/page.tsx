import config from "@/lib/config";

export default function GeneralSettingsPage() {
  return <> <h1 className="text-3xl font-semibold mb-4">General</h1>

      <div className="content space-y-2 frosted rounded-md p-2 flex flex-col">
        <h2 className="text-xl font-semibold col-span-full">App Info</h2>
        <div className="flex items-center justify-center gap-5"> <img src="/dashwise-icon.png" className="h-14"/> <span><span className="font-semibold text-center text-2xl">dashwise</span> <br /> Version {config.version}</span></div>
        <ul className="col-span-full flex gap-2 justify-center my-2">
          <li className="frosted rounded-md px-2 py-1 font-medium min-w-40 text-center"><a href="https://github.com/andreasmolnardev/dashwise-next" className="hover:text-(--primary)">GitHub Repo</a></li>
          <li className="frosted rounded-md px-2 py-1 font-medium min-w-40 text-center"><a href="https://github.com/andreasmolnardev/dashwise-next/issues" className="hover:text-(--primary)">GitHub Issues</a></li>
        </ul>
     </div></>;
}
