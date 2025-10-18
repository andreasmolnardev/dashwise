import config from "@/lib/config";

export default function GeneralSettingsPage() {
  return <> <h1 className="text-3xl font-semibold mb-4">General</h1>

      <div className="content space-y-2">
        <h2 className="text-xl">App Info</h2>
        <span>dashwise Version {config.version}</span>
        <ul>
          <li>Github Repo</li>
          <li>Github Issues</li>
          <li>Support me on Ko-fi</li>
        </ul>
     </div></>;
}
