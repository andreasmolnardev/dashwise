// Package caldav discovers CalDAV calendars and fetches bounded event windows.
package caldav

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	maxResponseBytes = 4 << 20
	maxCalendars     = 100
	maxEvents        = 1000
)

var ErrCredentials = errors.New("CalDAV credentials are not configured")

type Calendar struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

// Event fields retain the response shape used by the existing frontend.
type Event struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	Start       time.Time `json:"start"`
	End         time.Time `json:"end"`
	Location    string    `json:"location,omitempty"`
	IsAllDay    bool      `json:"isAllDay"`
}

type credentials struct {
	base     *url.URL
	username string
	password string
	allowed  map[string]bool
	ips      []net.IP
}

func newCredentials(ctx context.Context, environment map[string]string) (*credentials, error) {
	baseText := strings.TrimSpace(environment["CALDAV_URL"])
	username := environment["CALDAV_USERNAME"]
	encodedPassword := strings.TrimSpace(environment["CALDAV_PASSWORD"])
	if baseText == "" || username == "" || encodedPassword == "" {
		return nil, ErrCredentials
	}
	base, err := url.Parse(baseText)
	if err != nil || (base.Scheme != "https" && base.Scheme != "http") || base.Hostname() == "" || base.User != nil || base.Fragment != "" {
		return nil, errors.New("invalid CalDAV URL")
	}
	if strings.ContainsAny(username, "\r\n") {
		return nil, errors.New("invalid CalDAV username")
	}
	passwordBytes, err := base64.StdEncoding.DecodeString(encodedPassword)
	if err != nil {
		passwordBytes, err = base64.RawStdEncoding.DecodeString(encodedPassword)
	}
	if err != nil || len(passwordBytes) == 0 || strings.ContainsAny(string(passwordBytes), "\r\n") {
		return nil, errors.New("invalid CalDAV password encoding")
	}
	host := strings.ToLower(strings.TrimSuffix(base.Hostname(), "."))
	ips, err := resolveSafe(ctx, host)
	if err != nil {
		return nil, err
	}
	port := base.Port()
	if port == "" {
		if base.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	allowed := map[string]bool{originKey(base): true}
	return &credentials{base: base, username: username, password: string(passwordBytes), allowed: allowed, ips: ips}, nil
}

func resolveSafe(ctx context.Context, host string) ([]net.IP, error) {
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return nil, errors.New("CalDAV host is not allowed")
	}
	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else {
		var err error
		ips, err = net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, errors.New("could not resolve CalDAV host")
		}
	}
	if len(ips) == 0 || len(ips) > 32 {
		return nil, errors.New("CalDAV host resolution is invalid")
	}
	for _, ip := range ips {
		// Homelab RFC1918/ULA addresses are allowed, while local machine, link-local,
		// multicast and cloud metadata ranges are rejected.
		if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() || isMetadataIP(ip) {
			return nil, errors.New("CalDAV host resolves to a blocked address")
		}
	}
	return ips, nil
}

func isMetadataIP(ip net.IP) bool {
	blocked := []string{"169.254.169.254/32", "169.254.170.2/32", "100.100.100.200/32", "fd00:ec2::254/128"}
	for _, text := range blocked {
		_, network, _ := net.ParseCIDR(text)
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func originKey(u *url.URL) string { return strings.ToLower(u.Scheme + "://" + u.Host) }

func (c *credentials) client() *http.Client {
	port := c.base.Port()
	if port == "" {
		if c.base.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		Proxy:           nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, requestedPort, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			if !strings.EqualFold(strings.TrimSuffix(host, "."), strings.TrimSuffix(c.base.Hostname(), ".")) || requestedPort != port {
				return nil, errors.New("CalDAV request attempted to change host")
			}
			dialer := net.Dialer{Timeout: 6 * time.Second}
			var last error
			for _, ip := range c.ips {
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
				last = err
			}
			return nil, last
		},
	}
	return &http.Client{
		Transport: transport, Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 || originKey(req.URL) != originKey(c.base) {
				return errors.New("CalDAV redirected to an untrusted origin")
			}
			return nil
		},
	}
}

func (c *credentials) request(ctx context.Context, method string, target *url.URL, body string, depth string) ([]byte, error) {
	if target == nil || target.User != nil || target.Fragment != "" || !c.allowed[originKey(target)] {
		return nil, errors.New("CalDAV calendar URL has an untrusted origin")
	}
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target.String(), reader)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Accept", "application/xml, text/calendar, */*")
	if depth != "" {
		req.Header.Set("Depth", depth)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/xml; charset=utf-8")
	}
	resp, err := c.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("CalDAV request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("CalDAV server returned HTTP %d", resp.StatusCode)
	}
	limited := io.LimitReader(resp.Body, maxResponseBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(data) > maxResponseBytes {
		return nil, errors.New("CalDAV response exceeds size limit")
	}
	return data, nil
}

type multistatus struct {
	Responses []davResponse `xml:"response"`
}
type davResponse struct {
	Href  string     `xml:"href"`
	Props []propstat `xml:"propstat"`
}
type propstat struct {
	Status string  `xml:"status"`
	Prop   davProp `xml:"prop"`
}
type davProp struct {
	DisplayName          string `xml:"displayname"`
	CalendarData         string `xml:"calendar-data"`
	CurrentUserPrincipal struct {
		Href string `xml:"href"`
	} `xml:"current-user-principal"`
	CalendarHomeSet struct {
		Href string `xml:"href"`
	} `xml:"calendar-home-set"`
	ResourceType struct {
		Calendar *struct{} `xml:"calendar"`
	} `xml:"resourcetype"`
}

func (c *credentials) propfind(ctx context.Context, target *url.URL, depth string) (multistatus, error) {
	body := `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><d:current-user-principal/><c:calendar-home-set/><c:calendar-data/></d:prop></d:propfind>`
	data, err := c.request(ctx, "PROPFIND", target, body, depth)
	if err != nil {
		return multistatus{}, err
	}
	var result multistatus
	if err := xml.Unmarshal(data, &result); err != nil {
		return multistatus{}, errors.New("invalid CalDAV XML response")
	}
	return result, nil
}

func (c *credentials) calendars(ctx context.Context) ([]Calendar, error) {
	response, err := c.propfind(ctx, c.base, "1")
	if err != nil {
		return nil, err
	}
	entries := response.Responses
	if !hasCalendars(entries) {
		var homeHref, principalHref string
		for _, entry := range entries {
			for _, prop := range entry.Props {
				if homeHref == "" {
					homeHref = prop.Prop.CalendarHomeSet.Href
				}
				if principalHref == "" {
					principalHref = prop.Prop.CurrentUserPrincipal.Href
				}
			}
		}
		if homeHref == "" && principalHref != "" {
			principal, err := c.base.Parse(principalHref)
			if err != nil || originKey(principal) != originKey(c.base) {
				return nil, errors.New("CalDAV principal URL has an untrusted origin")
			}
			principalResult, err := c.propfind(ctx, principal, "0")
			if err != nil {
				return nil, err
			}
			for _, entry := range principalResult.Responses {
				for _, prop := range entry.Props {
					if homeHref == "" {
						homeHref = prop.Prop.CalendarHomeSet.Href
					}
				}
			}
		}
		if homeHref != "" {
			home, err := c.base.Parse(homeHref)
			if err != nil || originKey(home) != originKey(c.base) {
				return nil, errors.New("CalDAV calendar home has an untrusted origin")
			}
			homeResult, err := c.propfind(ctx, home, "1")
			if err != nil {
				return nil, err
			}
			entries = homeResult.Responses
		}
	}
	calendars := make([]Calendar, 0)
	seen := map[string]bool{}
	for _, entry := range entries {
		for _, prop := range entry.Props {
			if prop.Status != "" && !strings.Contains(prop.Status, " 200 ") {
				continue
			}
			if prop.Prop.ResourceType.Calendar == nil {
				continue
			}
			target, err := c.base.Parse(strings.TrimSpace(entry.Href))
			if err != nil || target.User != nil || target.Fragment != "" || originKey(target) != originKey(c.base) {
				continue
			}
			id := target.String()
			if seen[id] {
				continue
			}
			seen[id] = true
			name := strings.TrimSpace(prop.Prop.DisplayName)
			if name == "" {
				name = id
			}
			calendars = append(calendars, Calendar{ID: id, Name: name, URL: id})
			if len(calendars) >= maxCalendars {
				return calendars, nil
			}
		}
	}
	return calendars, nil
}

func hasCalendars(entries []davResponse) bool {
	for _, entry := range entries {
		for _, prop := range entry.Props {
			if prop.Prop.ResourceType.Calendar != nil {
				return true
			}
		}
	}
	return false
}

// DiscoverCalendars returns calendar metadata without returning credentials.
func DiscoverCalendars(ctx context.Context, environment map[string]string) ([]Calendar, error) {
	client, err := newCredentials(ctx, environment)
	if err != nil {
		return nil, err
	}
	return client.calendars(ctx)
}

// UpcomingEvents fetches events from now through 30 days ahead. Individual
// calendar failures are returned as an error rather than silently hiding data.
func UpcomingEvents(ctx context.Context, environment map[string]string) ([]Event, error) {
	start := time.Now().UTC()
	return EventsBetween(ctx, environment, start, start.Add(30*24*time.Hour))
}

func EventsBetween(ctx context.Context, environment map[string]string, start, end time.Time) ([]Event, error) {
	client, err := newCredentials(ctx, environment)
	if err != nil {
		return nil, err
	}
	if end.Before(start) || end.Sub(start) > 180*24*time.Hour {
		return nil, errors.New("CalDAV event range is invalid")
	}
	calendars, err := client.calendars(ctx)
	if err != nil {
		return nil, err
	}
	all := make([]Event, 0)
	for _, calendar := range calendars {
		target, err := url.Parse(calendar.URL)
		if err != nil {
			continue
		}
		body := calendarQuery(start.UTC(), end.UTC())
		data, err := client.request(ctx, "REPORT", target, body, "1")
		if err != nil {
			return nil, fmt.Errorf("fetch calendar %q: %w", calendar.Name, err)
		}
		var result multistatus
		if err := xml.Unmarshal(data, &result); err != nil {
			return nil, errors.New("invalid CalDAV event response")
		}
		for _, response := range result.Responses {
			for _, props := range response.Props {
				if props.Status != "" && !strings.Contains(props.Status, " 200 ") {
					continue
				}
				events := parseCalendarData(props.Prop.CalendarData, start, end)
				all = append(all, events...)
				if len(all) >= maxEvents {
					break
				}
			}
			if len(all) >= maxEvents {
				break
			}
		}
		if len(all) >= maxEvents {
			break
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].Start.Before(all[j].Start) })
	return all, nil
}

func calendarQuery(start, end time.Time) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="%s" end="%s"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`, start.UTC().Format("20060102T150405Z"), end.UTC().Format("20060102T150405Z"))
}

func parseCalendarData(data string, rangeStart, rangeEnd time.Time) []Event {
	lines := unfold(strings.ReplaceAll(data, "\r\n", "\n"))
	items := []Event{}
	inside := false
	props := map[string]string{}
	params := map[string]map[string]string{}
	for _, line := range lines {
		upper := strings.ToUpper(strings.TrimSpace(line))
		if upper == "BEGIN:VEVENT" {
			inside = true
			props = map[string]string{}
			params = map[string]map[string]string{}
			continue
		}
		if upper == "END:VEVENT" && inside {
			event, ok := makeEvent(props, params)
			if ok && !event.End.Before(rangeStart) && event.Start.Before(rangeEnd) {
				items = append(items, event)
			}
			inside = false
			continue
		}
		if !inside {
			continue
		}
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		left, value := line[:colon], line[colon+1:]
		pieces := strings.Split(left, ";")
		name := strings.ToUpper(pieces[0])
		propertyParams := map[string]string{}
		for _, part := range pieces[1:] {
			key, val, ok := strings.Cut(part, "=")
			if ok {
				propertyParams[strings.ToUpper(key)] = strings.Trim(val, `"`)
			}
		}
		props[name] = value
		params[name] = propertyParams
	}
	return items
}

func unfold(data string) []string {
	physical := strings.Split(data, "\n")
	lines := make([]string, 0, len(physical))
	for _, line := range physical {
		if len(line) == 0 {
			continue
		}
		if line[0] == ' ' || line[0] == '\t' {
			if len(lines) > 0 {
				lines[len(lines)-1] += line[1:]
			}
		} else {
			lines = append(lines, line)
		}
	}
	return lines
}

func makeEvent(p map[string]string, params map[string]map[string]string) (Event, bool) {
	start, allDay, ok := parseDate(p["DTSTART"], params["DTSTART"])
	if !ok {
		return Event{}, false
	}
	end, _, ok := parseDate(p["DTEND"], params["DTEND"])
	if !ok {
		end = start.Add(time.Hour)
	}
	id := unescapeText(p["UID"])
	if id == "" {
		id = fmt.Sprintf("%s/%s", start.Format(time.RFC3339Nano), unescapeText(p["SUMMARY"]))
	}
	return Event{ID: id, Title: unescapeText(p["SUMMARY"]), Description: unescapeText(p["DESCRIPTION"]), Start: start, End: end, Location: unescapeText(p["LOCATION"]), IsAllDay: allDay}, true
}

func parseDate(value string, params map[string]string) (time.Time, bool, bool) {
	if value == "" {
		return time.Time{}, false, false
	}
	if strings.Contains(value, "T") {
		if parsed, err := time.Parse("20060102T150405Z", value); err == nil {
			return parsed.UTC(), false, true
		}
		if parsed, err := time.Parse("20060102T1504Z", value); err == nil {
			return parsed.UTC(), false, true
		}
		if zone := params["TZID"]; zone != "" {
			location, err := time.LoadLocation(zone)
			if err == nil {
				for _, layout := range []string{"20060102T150405", "20060102T1504"} {
					if parsed, err := time.ParseInLocation(layout, value, location); err == nil {
						return parsed.UTC(), false, true
					}
				}
			}
		}
		for _, layout := range []string{"20060102T150405", "20060102T1504"} {
			if parsed, err := time.ParseInLocation(layout, value, time.UTC); err == nil {
				return parsed, false, true
			}
		}
		return time.Time{}, false, false
	}
	parsed, err := time.ParseInLocation("20060102", value, time.UTC)
	return parsed, true, err == nil
}

func unescapeText(value string) string {
	value = strings.ReplaceAll(value, `\n`, "\n")
	value = strings.ReplaceAll(value, `\N`, "\n")
	value = strings.ReplaceAll(value, `\,`, ",")
	value = strings.ReplaceAll(value, `\;`, ";")
	value = strings.ReplaceAll(value, `\\`, `\`)
	return value
}
