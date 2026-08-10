/**
* This file was @generated using pocketbase-typegen
*/

import type PocketBase from 'pocketbase'
import type { RecordService } from 'pocketbase'

export const Collections = {
	Authorigins: "_authOrigins",
	Externalauths: "_externalAuths",
	Mfas: "_mfas",
	Otps: "_otps",
	Superusers: "_superusers",
	AppInfo: "appInfo",
	Integrations: "integrations",
	JobLogs: "jobLogs",
	LinkItems: "linkItems",
	LinksFolders: "linksFolders",
	LinksLists: "linksLists",
	LinksTags: "linksTags",
	Monitors: "monitors",
	NewsFeeds: "newsFeeds",
	NewsSubscriptions: "newsSubscriptions",
	NotificationForwarders: "notificationForwarders",
	NotificationItems: "notificationItems",
	NotificationTopics: "notificationTopics",
	NotificationTopicTokens: "notificationTopicTokens",
	PageConfig: "pageConfig",
	SearchItems: "searchItems",
	Users: "users",
	WallpaperStore: "wallpaperStore",
} as const
export type Collections = typeof Collections[keyof typeof Collections]

// Alias types for improved usability
export type IsoDateString = string
export type IsoAutoDateString = string & { readonly autodate: unique symbol }
export type RecordIdString = string
export type FileNameString = string & { readonly filename: unique symbol }
export type HTMLString = string

type ExpandType<T> = unknown extends T
	? T extends unknown
		? { expand?: unknown }
		: { expand: T }
	: { expand: T }

// System fields
export type BaseSystemFields<T = unknown> = {
	id: RecordIdString
	collectionId: string
	collectionName: Collections
} & ExpandType<T>

export type AuthSystemFields<T = unknown> = {
	email: string
	emailVisibility: boolean
	username: string
	verified: boolean
} & BaseSystemFields<T>

// Record types for each collection

export type AuthoriginsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	fingerprint: string
	id: string
	recordRef: string
	updated: IsoAutoDateString
}

export type ExternalauthsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	provider: string
	providerId: string
	recordRef: string
	updated: IsoAutoDateString
}

export type MfasRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	method: string
	recordRef: string
	updated: IsoAutoDateString
}

export type OtpsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	password: string
	recordRef: string
	sentTo?: string
	updated: IsoAutoDateString
}

export type SuperusersRecord = {
	created: IsoAutoDateString
	email: string
	emailVisibility?: boolean
	id: string
	password: string
	tokenKey: string
	updated: IsoAutoDateString
	verified?: boolean
}

export type AppInfoRecord = {
	created: IsoAutoDateString
	id: string
	instanceName?: string
	updateAvailable?: string
	updated: IsoAutoDateString
	version?: string
}

export const IntegrationsTypeOptions = {
	"plugin": "plugin",
	"caldav": "caldav",
} as const
export type IntegrationsTypeOptions = typeof IntegrationsTypeOptions[keyof typeof IntegrationsTypeOptions]
export type IntegrationsRecord<Tconfig = unknown, Tenvironment = unknown, TlocalData = unknown> = {
	config?: null | Tconfig
	created: IsoAutoDateString
	environment?: null | Tenvironment
	id: string
	localData?: null | TlocalData
	name?: string
	source?: string
	type?: IntegrationsTypeOptions
	updated: IsoAutoDateString
	user?: RecordIdString
}

export const JobLogsStatusOptions = {
	"started": "started",
	"error": "error",
	"success": "success",
} as const
export type JobLogsStatusOptions = typeof JobLogsStatusOptions[keyof typeof JobLogsStatusOptions]
export type JobLogsRecord = {
	id: string
	job?: string
	message?: string
	runId?: string
	started: IsoAutoDateString
	status?: JobLogsStatusOptions
	updated: IsoAutoDateString
}

export type LinkItemsRecord = {
	collection?: RecordIdString
	created: IsoAutoDateString
	description?: string
	folder?: RecordIdString
	iconUrl?: string
	id: string
	position?: number
	tags?: RecordIdString[]
	title?: string
	updated: IsoAutoDateString
	url?: string
}

export type LinksFoldersRecord = {
	created: IsoAutoDateString
	icon?: string
	id: string
	list?: RecordIdString
	name?: string
	parentFolder?: string
	position?: number
	tags?: RecordIdString[]
	updated: IsoAutoDateString
}

export const LinksListsTypeOptions = {
	"user-defined": "user-defined",
	"home": "home",
} as const
export type LinksListsTypeOptions = typeof LinksListsTypeOptions[keyof typeof LinksListsTypeOptions]
export type LinksListsRecord = {
	created: IsoAutoDateString
	description?: string
	icon?: string
	id: string
	name?: string
	type?: LinksListsTypeOptions
	updated: IsoAutoDateString
	user?: RecordIdString
}

export type LinksTagsRecord = {
	color?: string
	created: IsoAutoDateString
	id: string
	name?: string
	updated: IsoAutoDateString
}

export const MonitorsStatusOptions = {
	"disabled": "disabled",
	"initiated": "initiated",
	"unhealthy": "unhealthy",
	"healthy": "healthy",
} as const
export type MonitorsStatusOptions = typeof MonitorsStatusOptions[keyof typeof MonitorsStatusOptions]
export type MonitorsRecord<TpingOutlierThreshold = unknown, TpingOutliers = unknown, Tpings = unknown, TresponseUpFilter = unknown> = {
	created: IsoAutoDateString
	endpoint?: string
	endpointAuth?: string
	id: string
	notifyOnStatusChange?: boolean
	notifyTopicId?: string
	pingAvgLatency?: string
	pingOutlierThreshold?: null | TpingOutlierThreshold
	pingOutliers?: null | TpingOutliers
	pings?: null | Tpings
	responseUpFilter?: null | TresponseUpFilter
	source?: string
	sourcelinkId?: RecordIdString
	status?: MonitorsStatusOptions[]
	updated: IsoAutoDateString
	userId?: string
}

export type NewsFeedsRecord = {
	created: IsoAutoDateString
	excludedSubscriptionRefs?: RecordIdString[]
	icon?: string
	id: string
	maxFeedItems?: number
	subscriptionRefs?: RecordIdString[]
	title?: string
	updated: IsoAutoDateString
	userId?: RecordIdString
}

export type NewsSubscriptionsRecord<Tjson = unknown, TlinkReplaceRule = unknown> = {
	created: IsoAutoDateString
	fallbackThumbnailUrl?: string
	fetchErrors?: string
	icon?: string
	id: string
	linkReplaceRule?: null | TlinkReplaceRule
	thumbnailOverwriteUrl?: string
	title?: string
	updated: IsoAutoDateString
	url?: string
}

export type NotificationForwardersRecord = {
	created: IsoAutoDateString
	id: string
	isActive?: boolean
	target?: string
	topic?: RecordIdString
	updated: IsoAutoDateString
}

export const NotificationItemsForwardStatusOptions = {
	"none": "none",
	"queued": "queued",
	"done": "done",
} as const
export type NotificationItemsForwardStatusOptions = typeof NotificationItemsForwardStatusOptions[keyof typeof NotificationItemsForwardStatusOptions]
export type NotificationItemsRecord<Tcontent = unknown> = {
	content?: null | Tcontent
	created: IsoAutoDateString
	forwardStatus?: NotificationItemsForwardStatusOptions
	id: string
	priority?: number
	source?: string
	status?: string
	topicId?: RecordIdString
	updated: IsoAutoDateString
}

export type NotificationTopicsRecord = {
	created: IsoAutoDateString
	id: string
	title: string
	updated: IsoAutoDateString
	userId: string
}

export type NotificationTopicTokensRecord = {
	created: IsoAutoDateString
	expires?: IsoDateString
	id: string
	token?: string
	topic?: RecordIdString
	updated: IsoAutoDateString
}

export type PageConfigRecord<Tconfig = unknown> = {
	associatedUserId?: string
	config?: null | Tconfig
	created: IsoAutoDateString
	id: string
	pageName?: string
	updated: IsoAutoDateString
}

export type SearchItemsRecord<Ttags = unknown, TusageStats = unknown> = {
	action?: string
	app?: string
	created: IsoAutoDateString
	icon?: string
	id: string
	isPinned?: boolean
	name?: string
	secondary?: string
	sourceId?: string
	sourceUpdated?: string
	tags?: null | Ttags
	updated: IsoAutoDateString
	usageStats?: null | TusageStats
	user?: RecordIdString
}

export type UsersRecord<TappearancePreferences = unknown, TlocalizationPreferences = unknown, TscreensaverPreferences = unknown, TsearchPreferences = unknown> = {
	appearancePreferences?: null | TappearancePreferences
	avatar?: FileNameString
	created: IsoAutoDateString
	email: string
	emailVisibility?: boolean
	id: string
	isOnboarded?: boolean
	localizationPreferences?: null | TlocalizationPreferences
	name?: string
	password: string
	screensaverPreferences?: null | TscreensaverPreferences
	searchPreferences?: null | TsearchPreferences
	tokenKey: string
	updated: IsoAutoDateString
	verified?: boolean
}

export type WallpaperStoreRecord = {
	created: IsoAutoDateString
	fileName?: string
	id: string
	image?: FileNameString
	updated: IsoAutoDateString
	userId?: string
}

// Response types include system fields and match responses from the PocketBase API
export type AuthoriginsResponse<Texpand = unknown> = Required<AuthoriginsRecord> & BaseSystemFields<Texpand>
export type ExternalauthsResponse<Texpand = unknown> = Required<ExternalauthsRecord> & BaseSystemFields<Texpand>
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> & BaseSystemFields<Texpand>
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> & BaseSystemFields<Texpand>
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> & AuthSystemFields<Texpand>
export type AppInfoResponse<Texpand = unknown> = Required<AppInfoRecord> & BaseSystemFields<Texpand>
export type IntegrationsResponse<Tconfig = unknown, Tenvironment = unknown, TlocalData = unknown, Texpand = unknown> = Required<IntegrationsRecord<Tconfig, Tenvironment, TlocalData>> & BaseSystemFields<Texpand>
export type JobLogsResponse<Texpand = unknown> = Required<JobLogsRecord> & BaseSystemFields<Texpand>
export type LinkItemsResponse<Texpand = unknown> = Required<LinkItemsRecord> & BaseSystemFields<Texpand>
export type LinksFoldersResponse<Texpand = unknown> = Required<LinksFoldersRecord> & BaseSystemFields<Texpand>
export type LinksListsResponse<Texpand = unknown> = Required<LinksListsRecord> & BaseSystemFields<Texpand>
export type LinksTagsResponse<Texpand = unknown> = Required<LinksTagsRecord> & BaseSystemFields<Texpand>
export type MonitorsResponse<TpingOutlierThreshold = unknown, TpingOutliers = unknown, Tpings = unknown, TresponseUpFilter = unknown, Texpand = unknown> = Required<MonitorsRecord<TpingOutlierThreshold, TpingOutliers, Tpings, TresponseUpFilter>> & BaseSystemFields<Texpand>
export type NewsFeedsResponse<Texpand = unknown> = Required<NewsFeedsRecord> & BaseSystemFields<Texpand>
export type NewsSubscriptionsResponse<Tjson = unknown, TlinkReplaceRule = unknown, Texpand = unknown> = Required<NewsSubscriptionsRecord<Tjson, TlinkReplaceRule>> & BaseSystemFields<Texpand>
export type NotificationForwardersResponse<Texpand = unknown> = Required<NotificationForwardersRecord> & BaseSystemFields<Texpand>
export type NotificationItemsResponse<Tcontent = unknown, Texpand = unknown> = Required<NotificationItemsRecord<Tcontent>> & BaseSystemFields<Texpand>
export type NotificationTopicsResponse<Texpand = unknown> = Required<NotificationTopicsRecord> & BaseSystemFields<Texpand>
export type NotificationTopicTokensResponse<Texpand = unknown> = Required<NotificationTopicTokensRecord> & BaseSystemFields<Texpand>
export type PageConfigResponse<Tconfig = unknown, Texpand = unknown> = Required<PageConfigRecord<Tconfig>> & BaseSystemFields<Texpand>
export type SearchItemsResponse<Ttags = unknown, TusageStats = unknown, Texpand = unknown> = Required<SearchItemsRecord<Ttags, TusageStats>> & BaseSystemFields<Texpand>
export type UsersResponse<TappearancePreferences = unknown, TlocalizationPreferences = unknown, TscreensaverPreferences = unknown, TsearchPreferences = unknown, Texpand = unknown> = Required<UsersRecord<TappearancePreferences, TlocalizationPreferences, TscreensaverPreferences, TsearchPreferences>> & AuthSystemFields<Texpand>
export type WallpaperStoreResponse<Texpand = unknown> = Required<WallpaperStoreRecord> & BaseSystemFields<Texpand>

// Types containing all Records and Responses, useful for creating typing helper functions

export type CollectionRecords = {
	_authOrigins: AuthoriginsRecord
	_externalAuths: ExternalauthsRecord
	_mfas: MfasRecord
	_otps: OtpsRecord
	_superusers: SuperusersRecord
	appInfo: AppInfoRecord
	integrations: IntegrationsRecord
	jobLogs: JobLogsRecord
	linkItems: LinkItemsRecord
	linksFolders: LinksFoldersRecord
	linksLists: LinksListsRecord
	linksTags: LinksTagsRecord
	monitors: MonitorsRecord
	newsFeeds: NewsFeedsRecord
	newsSubscriptions: NewsSubscriptionsRecord
	notificationForwarders: NotificationForwardersRecord
	notificationItems: NotificationItemsRecord
	notificationTopics: NotificationTopicsRecord
	notificationTopicTokens: NotificationTopicTokensRecord
	pageConfig: PageConfigRecord
	searchItems: SearchItemsRecord
	users: UsersRecord
	wallpaperStore: WallpaperStoreRecord
}

export type CollectionResponses = {
	_authOrigins: AuthoriginsResponse
	_externalAuths: ExternalauthsResponse
	_mfas: MfasResponse
	_otps: OtpsResponse
	_superusers: SuperusersResponse
	appInfo: AppInfoResponse
	integrations: IntegrationsResponse
	jobLogs: JobLogsResponse
	linkItems: LinkItemsResponse
	linksFolders: LinksFoldersResponse
	linksLists: LinksListsResponse
	linksTags: LinksTagsResponse
	monitors: MonitorsResponse
	newsFeeds: NewsFeedsResponse
	newsSubscriptions: NewsSubscriptionsResponse
	notificationForwarders: NotificationForwardersResponse
	notificationItems: NotificationItemsResponse
	notificationTopics: NotificationTopicsResponse
	notificationTopicTokens: NotificationTopicTokensResponse
	pageConfig: PageConfigResponse
	searchItems: SearchItemsResponse
	users: UsersResponse
	wallpaperStore: WallpaperStoreResponse
}

// Utility types for create/update operations

type ProcessCreateAndUpdateFields<T> = Omit<{
	// Omit AutoDate fields
	[K in keyof T as Extract<T[K], IsoAutoDateString> extends never ? K : never]: 
		// Convert FileNameString to File
		T[K] extends infer U ? 
			U extends (FileNameString | FileNameString[]) ? 
				U extends any[] ? File[] : File 
			: U
		: never
}, 'id'>

// Create type for Auth collections
export type CreateAuth<T> = {
	id?: RecordIdString
	email: string
	emailVisibility?: boolean
	password: string
	passwordConfirm: string
	verified?: boolean
} & ProcessCreateAndUpdateFields<T>

// Create type for Base collections
export type CreateBase<T> = {
	id?: RecordIdString
} & ProcessCreateAndUpdateFields<T>

// Update type for Auth collections
export type UpdateAuth<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof AuthSystemFields>
> & {
	email?: string
	emailVisibility?: boolean
	oldPassword?: string
	password?: string
	passwordConfirm?: string
	verified?: boolean
}

// Update type for Base collections
export type UpdateBase<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof BaseSystemFields>
>

// Get the correct create type for any collection
export type Create<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? CreateAuth<CollectionRecords[T]>
		: CreateBase<CollectionRecords[T]>

// Get the correct update type for any collection
export type Update<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? UpdateAuth<CollectionRecords[T]>
		: UpdateBase<CollectionRecords[T]>

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = {
	collection<T extends keyof CollectionResponses>(
		idOrName: T
	): RecordService<CollectionResponses[T]>
} & PocketBase
