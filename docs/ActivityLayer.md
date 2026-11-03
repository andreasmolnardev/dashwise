# Activity layer

Dashwise runs the API, persistence, activity workers, and realtime endpoints in
the Go backend. Activity records are stored separately from notifications:
activities provide a durable event history, while notifications keep their
read state, topics, and forwarding behavior.

Built-in Go services and enabled JavaScript SDK integrations can publish
activities through the Go activity store. SDK manifests declare the activity
types an integration may publish. Owners can enable or disable those
definitions and choose which notification topics make an activity relevant.
The backend validates the integration owner and declaration before accepting
SDK activity updates.

The authenticated activity API provides history and definition preferences.
The authenticated activity WebSocket sends activity updates to the retained
React frontend. Resource change subscriptions use the same realtime connection
but carry resource revisions rather than activity records.

See [Development](Development.md) for the Go backend layout and local setup,
and [Integrations](Integrations.md) for integration configuration and runtime
details.
