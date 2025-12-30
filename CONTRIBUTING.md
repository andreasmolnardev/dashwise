# Contributing to dashwise
To contribute, you might follow these steps:
1. Comment on the GitHub Issue you want to work on or open a new one
2. Fork the repo
3. Start the development setup using docker-compose.yaml and by running `docker compose up`
4. Depending on the ticket, you might also consider other guidelines below.
5. Before opening a PR, make sure to run npm run build and confirm it runs without errors during build (can be run locally or inside a container, linting is disabled)
6. Open a PR, which may include the following:
   - reference an issue
   - short description
   - screenshots if UI changes
  
## Widgets
To add a new widget, follow these steps:

1. **Register the widget**
   - Add an entry to `/public/widgets.json` under the correct category.
     - If the widget depends on external services (integration), prefix the category with `int:`.
   - Example format:
     ```json
     {
       "slug": "weather-overview",
       "name": "Quick overview",
       "description": "",
       "exampleProps": {
         "locationDisplayname": "Munich",
         "locationCoordinates": "48.1337, 11.5720",
         "unit": "c",
         "showLocation": false
       },
       "properties": {
         "locationDisplayname": "as:string",
         "locationCoordinates": "as:string",
         "unit": "f|c",
         "showLocation": "as:bool"
       }
     }
     ```
     - `exampleProps` is used for previewing the widget.

2. **Add switch-case entry**
   - Update `components/widgets/Widget.tsx` to load your widget dynamically via `import(...)`.
   - Add a new case to `switch (type)` pointing to your new component.

3. **Create a widget component**
   - Place the component in:  
     `components/widgets/dashboard/`
   - Components must accept:
     ```ts
     export type WidgetItemProps = {
       className?: string;
       params?: Record<string, any>;
     };
     ```

4. **(Optional) Implement an API client**
   - If your widget requires calls to external services:
     - Create a client in:  
       `lib/clients/<name>/client.ts`
     - Example pattern (Karakeep):
       ```ts
       export async function getBookmarks({ serverUrl, token }) {
         // fetch logic
       }
       ```
     - Keep the client focused: input → fetch → normalized output.
---

Thank you for contributing and helping improve dashwise!

