#!/usr/bin/env node
/**
 * Builds the public Apollo Signal API reference from the API's OpenAPI artifact
 * and Tesseract SDK manifest.
 *
 * The OpenAPI artifact describes HTTP contracts. The manifest is the authority
 * for which routes are public. Keeping both inputs prevents dashboard-only and
 * service-to-service routes from leaking into the developer documentation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(DOCS_ROOT, "signal/api-reference/openapi.json");
const DOCS_CONFIG_PATH = path.join(DOCS_ROOT, "docs.json");
const DEFAULT_API_ROOT = path.resolve(DOCS_ROOT, "../../../APIs/apollo-signal-api");
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const PROBLEM_SCHEMA = "#/components/schemas/com.apollodeploy.commons.core.error.ApiProblem";
const SIGNAL_REGIONS = ["us-east-1", "af-south-1", "eu-west-1", "ap-southeast-1"];
const WEBHOOK_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.opened",
  "email.clicked",
  "email.failed",
  "email.rejected",
  "email.delivery_delayed",
  "email.suppressed",
  "email.unsubscribed",
  "email.read_engaged",
  "webhook.test",
];

const TAGS = {
  emails: {
    name: "Emails",
    description: "Send, inspect, cancel, validate, and stream transactional email activity.",
  },
  metrics: {
    name: "Metrics",
    description: "Read project, topic, message, and deliverability analytics.",
  },
  suppressions: {
    name: "Suppressions",
    description: "Manage addresses that Apollo Signal must not send to.",
  },
  segments: {
    name: "Segments",
    description: "Create dynamic contact groups and inspect their membership.",
  },
  topics: {
    name: "Topics",
    description: "Manage subscription topics and topic membership.",
  },
  contactProperties: {
    name: "Contact properties",
    description: "Define the custom fields available on project contacts.",
  },
  contacts: {
    name: "Contacts",
    description: "Manage contacts, audience membership, images, activity, and engagement data.",
  },
  webhooks: {
    name: "Webhooks",
    description: "Manage webhook endpoints, deliveries, tests, and replays.",
  },
  apiKeys: {
    name: "API key usage",
    description: "Inspect API key metadata and request usage without exposing raw keys.",
  },
  projects: {
    name: "Projects",
    description: "Inspect projects and project-scoped email logs.",
  },
  sendingDomains: {
    name: "Sending domains",
    description: "Register, verify, inspect, and remove sending domains and BIMI configuration.",
  },
};

const PERMISSIONS = new Map();

function grant(operationIds, permissions) {
  for (const operationId of operationIds) PERMISSIONS.set(operationId, permissions);
}

grant(
  ["sendEmail", "batchSendEmails", "cancelEmail", "bulkCancelEmails", "issueStreamToken", "validateLinks"],
  ["emails:send"],
);
grant(["getEmail"], ["emails:read"]);
grant(
  [
    "getTopicPerformance",
    "getEmailPerformance",
    "getEmailEngagement",
    "getProjectMetricsSummary",
    "getProjectMetricsTimeline",
    "getMetricsAdvisor",
  ],
  ["emails:send", "emails:read", "metrics:read"],
);
grant(["listSuppressions", "exportSuppressions"], ["suppressions:read"]);
grant(["addSuppression", "removeSuppression", "importSuppressions"], ["suppressions:write"]);
grant(["listSegments", "getSegment", "listContactsInSegment"], ["contacts:read"]);
grant(["createSegment", "deleteSegment"], ["contacts:write"]);
grant(["listTopics", "getTopic", "listContactsInTopic"], ["contacts:read"]);
grant(["createTopic", "updateTopic", "deleteTopic"], ["contacts:write"]);
grant(["listContactProperties", "getContactProperty"], ["contacts:read"]);
grant(["createContactProperty", "updateContactProperty", "deleteContactProperty"], ["contacts:write"]);
grant(
  [
    "listContacts",
    "getContact",
    "listContactSegments",
    "getContactTopics",
    "getContactActivity",
    "getContactEngagementScore",
    "getContactEmailValidationStatus",
  ],
  ["contacts:read"],
);
grant(
  [
    "createContact",
    "updateContact",
    "deleteContact",
    "uploadContactImage",
    "setContactImageUrl",
    "deleteContactImage",
    "addContactToSegment",
    "removeContactFromSegment",
    "updateContactTopics",
    "refreshContactEngagementScore",
    "recordContactEmailValidation",
  ],
  ["contacts:write"],
);
grant(
  ["listWebhooks", "getWebhook", "listWebhookDeliveries", "getWebhookDelivery"],
  ["webhooks:read"],
);
grant(
  ["createWebhook", "updateWebhook", "deleteWebhook", "testWebhook", "replayWebhookDelivery"],
  ["webhooks:write"],
);
grant(["listApiKeys", "getApiKey", "getApiKeyUsage", "exportApiKeyUsage"], ["usage:read"]);
grant(["listProjects", "getProject"], ["projects:read"]);
grant(["updateProject"], ["projects:write"]);
grant(["listEmails", "getProjectEmail", "getEmailTimeline"], ["emails:read"]);
grant(["listDomains", "getDomain"], ["domains:read"]);
grant(["registerDomain", "verifyDomain", "deleteDomain", "verifyBimi", "updateBimi"], ["domains:write"]);

const RATE_LIMITS = {
  "email-send": { requests: 300, seconds: 60 },
  "email-batch": { requests: 30, seconds: 60 },
  contacts: { requests: 200, seconds: 60 },
  "contact-properties": { requests: 60, seconds: 60 },
  projects: { requests: 60, seconds: 60 },
  segments: { requests: 60, seconds: 60 },
  domains: { requests: 30, seconds: 300 },
  suppressions: { requests: 120, seconds: 60 },
  topics: { requests: 120, seconds: 60 },
  webhooks: { requests: 60, seconds: 60 },
  metrics: { requests: 120, seconds: 60 },
};

const METRIC_DESCRIPTIONS = {
  getTopicPerformance:
    "Returns delivery and engagement performance for one topic over the selected time window. " +
    "API-key authentication always uses the key's project; `projectId` is only needed for dashboard-session authentication.",
  getEmailPerformance:
    "Returns delivery and engagement totals for one email, including opens, clicks, bounces, and complaints when available.",
  getEmailEngagement:
    "Returns read and scroll engagement analytics for one email. Values are present only when read-engagement tracking collected them.",
  getProjectMetricsSummary:
    "Returns aggregate delivery and engagement counts and rates for the authenticated project over the selected time window.",
  getProjectMetricsTimeline:
    "Returns project metrics bucketed by hour or day. Use `format=detailed` for per-status series or `format=compact` for the compact timeline.",
  getMetricsAdvisor:
    "Returns the current deliverability score and actionable recommendations for the authenticated project.",
};

const RESPONSE_DESCRIPTIONS = {
  200: "Request completed successfully.",
  201: "Resource created successfully.",
  204: "Request completed successfully with no response body.",
  400: "The request is malformed or contains invalid input.",
  401: "The API key or stream token is missing, invalid, expired, or inactive.",
  402: "The project's plan does not include this operation or its quota is exhausted.",
  403: "The credential lacks the required permission or cannot access this project.",
  404: "The requested resource was not found in the authenticated project.",
  409: "The request conflicts with the resource's current state.",
  413: "The request or imported data exceeds the supported size.",
  415: "The request uses an unsupported media type.",
  422: "The request is syntactically valid but violates a domain requirement.",
  429: "The endpoint rate limit was exceeded. Wait for the `Retry-After` interval before retrying.",
  500: "Apollo Signal could not complete the request.",
  502: "A required upstream provider could not complete the request.",
  503: "A required service is temporarily unavailable.",
};

function usage() {
  console.log(`Usage: node scripts/generate-signal-api-reference.mjs [options]

Options:
  --api-root <path>  Apollo Signal API checkout (default: ${DEFAULT_API_ROOT})
  --openapi <path>   Override the OpenAPI input path
  --manifest <path>  Override the Tesseract manifest input path
  --check            Verify the checked artifact instead of writing it
  --help             Show this help`);
}

function parseArgs(argv) {
  let apiRoot = DEFAULT_API_ROOT;
  let openApiPath;
  let manifestPath;
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--api-root requires a path");
      apiRoot = path.resolve(value);
      index += 1;
    } else if (arg === "--openapi") {
      const value = argv[index + 1];
      if (!value) throw new Error("--openapi requires a path");
      openApiPath = path.resolve(value);
      index += 1;
    } else if (arg === "--manifest") {
      const value = argv[index + 1];
      if (!value) throw new Error("--manifest requires a path");
      manifestPath = path.resolve(value);
      index += 1;
    } else if (arg === "--check") {
      check = true;
    } else if (arg === "--help") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { apiRoot, openApiPath, manifestPath, check };
}

function readJson(filePath, missingHint) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} does not exist. ${missingHint}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function routePath(domain, route) {
  const suffix = route.url === "/" ? "" : route.url;
  return `${domain.prefix}${suffix}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function publicRoutes(manifest) {
  const routes = [];
  for (const domain of manifest.domains ?? []) {
    if ((domain.stability ?? "public") === "internal") continue;
    const domainRoutes = (domain.routes ?? []).filter((route) => route.sdk?.internal !== true);
    if (domainRoutes.length === 0) continue;
    if (!TAGS[domain.domain]) {
      throw new Error(`Public manifest domain has no documentation tag: ${domain.domain}`);
    }
    for (const route of domainRoutes) {
      routes.push({
        domain: domain.domain,
        method: route.method.toLowerCase(),
        operationId: route.sdk?.operationId ?? route.schema?.operationId,
        path: routePath(domain, route),
      });
    }
  }
  return routes;
}

function ratePolicy(route) {
  if (route.operationId === "sendEmail") return "email-send";
  if (route.operationId === "batchSendEmails") return "email-batch";
  if (["listProjects", "getProject", "updateProject"].includes(route.operationId)) return "projects";
  return {
    metrics: "metrics",
    suppressions: "suppressions",
    segments: "segments",
    topics: "topics",
    contactProperties: "contact-properties",
    contacts: "contacts",
    webhooks: "webhooks",
    sendingDomains: "domains",
  }[route.domain];
}

function parameterDescription(parameter, route) {
  const descriptions = {
    projectId:
      route.operationId === "issueStreamToken"
        ? "Project identifier used for dashboard-session authentication. API keys always select the key's project."
        : "Project identifier. For API-key authentication, it must match the project bound to the key.",
    emailId: "Apollo Signal email identifier.",
    contactId: "Contact identifier in this project.",
    segmentId: "Segment identifier in this project.",
    topicId: "Topic identifier in this project.",
    propertyId: "Contact property identifier in this project.",
    endpointId: "Webhook endpoint identifier in this project.",
    deliveryId: "Webhook delivery identifier.",
    keyId: "API key identifier. Raw API key values are never accepted here.",
    page: "1-based page number. Defaults to `1`.",
    size: "Number of records per page. Defaults to `20`; maximum `100`.",
    limit: "Maximum usage records to return. Defaults to `100`; values are clamped to `1`–`500`.",
    before: "Return records before this ISO 8601 timestamp.",
    after: "Return records after this ISO 8601 timestamp, or continue from the supplied membership cursor where documented.",
    format: "Export encoding: `csv` (default) or `json`.",
    id: route.path.includes("/topics/") ? "Topic identifier." : "Email identifier.",
  };
  return descriptions[parameter.name] ?? `${parameter.name} value for this operation.`;
}

function problemResponse(status) {
  return {
    description: RESPONSE_DESCRIPTIONS[status],
    headers: {},
    content: {
      "application/problem+json": {
        schema: { $ref: PROBLEM_SCHEMA },
      },
    },
  };
}

function normalizeResponses(operation, route, policyName) {
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    if (!response.description) {
      response.description = RESPONSE_DESCRIPTIONS[status] ?? "Response returned by Apollo Signal.";
    }
    const json = response.content?.["application/json"];
    if (json?.schema?.$ref === PROBLEM_SCHEMA) {
      delete response.content["application/json"];
      response.content["application/problem+json"] = json;
    }
  }

  if (route.operationId === "streamEmailEvents") {
    operation.responses["200"] = {
      description: "A Server-Sent Events stream. Each `data` field contains one JSON event object.",
      headers: {},
      content: {
        "text/event-stream": {
          schema: { type: "string" },
          example:
            'data: {"type":"delivered","emailId":"email_01...","occurredAt":"2026-08-25T10:00:00Z","data":{}}\n\n',
        },
      },
    };
  }

  if (route.operationId === "streamEmailEvents") {
    operation.responses["401"] ??= problemResponse("401");
  } else {
    operation.responses["401"] ??= problemResponse("401");
    operation.responses["403"] ??= problemResponse("403");
  }

  if (policyName) {
    operation.responses["429"] ??= problemResponse("429");
    operation.responses["429"].description = RESPONSE_DESCRIPTIONS["429"];
    operation.responses["429"].headers ??= {};
    operation.responses["429"].headers["Retry-After"] = {
      description: "Whole seconds to wait before retrying.",
      schema: { type: "integer", minimum: 1 },
    };
    const json = operation.responses["429"].content?.["application/json"];
    if (json) {
      delete operation.responses["429"].content["application/json"];
      operation.responses["429"].content["application/problem+json"] = json;
    }
  }
}

function improveTransportContract(operation, route) {
  if (route.operationId === "uploadContactImage") {
    operation.requestBody = {
      description:
        "Multipart form containing exactly one profile image in the `file` field. " +
        "The file must be JPEG, PNG, WebP, or GIF and no larger than 5 MiB.",
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["file"],
            properties: {
              file: {
                type: "string",
                format: "binary",
                description: "JPEG, PNG, WebP, or GIF profile image, up to 5 MiB.",
              },
            },
          },
        },
      },
    };
  }

  if (route.operationId === "exportSuppressions") {
    operation.responses["200"] = {
      description:
        "Streamed CSV attachment with the columns `email`, `reason`, and `created_at`.",
      headers: {
        "Content-Disposition": {
          description: "Attachment filename in the form `suppressions-{projectId}.csv`.",
          schema: { type: "string" },
        },
      },
      content: {
        "text/csv": {
          schema: {
            type: "string",
            description: "UTF-8 CSV suppression export.",
          },
          example: 'email,reason,created_at\n"user@example.com","manual","2026-08-25T10:00:00Z"\n',
        },
      },
    };
  }

  if (route.operationId === "exportApiKeyUsage") {
    operation.responses["200"] = {
      description:
        "Usage-log attachment encoded as CSV by default, or JSON when `format=json` is supplied.",
      headers: {
        "Content-Disposition": {
          description: "Attachment filename selected for the requested export format.",
          schema: { type: "string" },
        },
      },
      content: {
        "text/csv": {
          schema: { type: "string", description: "UTF-8 CSV usage export." },
        },
        "application/json": {
          schema: { type: "string", description: "JSON usage export document." },
        },
      },
    };
  }
}

function enrichOperation(sourceOperation, route) {
  const operation = structuredClone(sourceOperation);
  const permissions = PERMISSIONS.get(route.operationId);
  if (!permissions && route.operationId !== "streamEmailEvents") {
    throw new Error(`No permission mapping for public operation ${route.operationId}`);
  }

  operation.operationId = route.operationId;
  operation.tags = [TAGS[route.domain].name];
  operation.description = METRIC_DESCRIPTIONS[route.operationId] ?? operation.description;
  if (route.operationId === "sendEmail") {
    operation.description = operation.description?.replace(
      "Emails are delivered through Amazon SES. Delivery status events (delivered, available via webhooks and the email timeline endpoint.",
      "Emails are delivered through Amazon SES. Delivery events are available through webhooks and the email timeline endpoint.",
    );
  }
  if (route.operationId === "streamEmailEvents") {
    operation.description =
      "Opens a project-scoped Server-Sent Events stream. First issue a one-time token, then connect within 60 seconds. " +
      "The stream can emit `sent`, `delivered`, `bounced`, `complained`, `opened`, `clicked`, and `unsubscribed` events. " +
      "Each JSON payload contains `type`, `emailId`, `occurredAt`, and an event-specific `data` object.";
  }
  operation.description ||= "Performs this operation for the authenticated Apollo Signal project.";
  improveTransportContract(operation, route);

  for (const parameter of operation.parameters ?? []) {
    parameter.description ||= parameterDescription(parameter, route);
  }
  if (operation.requestBody && !operation.requestBody.description) {
    operation.requestBody.description = "Request body for this operation.";
  }

  const requirementLines = [];
  if (route.operationId === "streamEmailEvents") {
    operation.security = [{ streamTokenAuth: [] }];
    requirementLines.push(
      "**Authentication:** one-time stream token from `POST /v1/emails/{projectId}/stream/token`.",
    );
  } else {
    operation.security = [{ bearerAuth: [] }];
    const permissionText = permissions.map((permission) => `\`${permission}\``).join(" or ");
    operation["x-required-permissions"] = permissions;
    requirementLines.push(`**Permission:** ${permissionText}.`);
    if (route.path.includes("{projectId}") && route.operationId !== "issueStreamToken") {
      requirementLines.push("**Project access:** the path project must match the API key's project.");
    }
    if (route.operationId === "issueStreamToken") {
      requirementLines.push("**Project selection:** API keys always issue a token for the project bound to the key.");
    }
  }

  if (route.operationId === "sendEmail") {
    requirementLines.push("**Safe retries:** place `idempotencyKey` in the JSON body; Apollo Signal does not use an idempotency header.");
  }
  if (route.operationId === "batchSendEmails") {
    requirementLines.push("**Safe retries:** give each item its own `idempotencyKey`; items settle independently.");
  }
  if (route.operationId === "registerDomain") {
    requirementLines.push(
      "**Region:** a domain outside the project's home region requires the multi-region entitlement.",
    );
  }

  const policyName = ratePolicy(route);
  if (policyName) {
    const policy = RATE_LIMITS[policyName];
    operation["x-rate-limit"] = { ...policy, policy: policyName };
    requirementLines.push(
      `**HTTP rate limit:** ${policy.requests} requests per ${policy.seconds} seconds per API key.`,
    );
  }

  operation.description = `${operation.description.trim()}\n\n### Requirements\n\n- ${requirementLines.join("\n- ")}`;
  normalizeResponses(operation, route, policyName);
  return operation;
}

function collectSchemaRefs(value, refs = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, refs);
  } else if (value && typeof value === "object") {
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/components/schemas/")) {
      refs.add(value.$ref.slice("#/components/schemas/".length));
    }
    for (const child of Object.values(value)) collectSchemaRefs(child, refs);
  }
  return refs;
}

function reachableSchemas(paths, sourceSchemas) {
  const names = collectSchemaRefs(paths);
  const queue = [...names];
  const schemas = {};

  while (queue.length > 0) {
    const name = queue.shift();
    if (schemas[name]) continue;
    const schema = sourceSchemas[name];
    if (!schema) throw new Error(`Referenced schema is missing: ${name}`);
    schemas[name] = structuredClone(schema);
    for (const dependency of collectSchemaRefs(schema)) {
      if (!schemas[dependency]) queue.push(dependency);
    }
  }

  return schemas;
}

function documentSchema(schemas, name, documentation) {
  const schema = schemas[name];
  if (!schema) return;
  if (documentation.description) schema.description = documentation.description;
  if (documentation.required) schema.required = documentation.required;
  if (documentation.enum) schema.enum = documentation.enum;
  for (const [propertyName, patch] of Object.entries(documentation.properties ?? {})) {
    const property = schema.properties?.[propertyName];
    if (!property) throw new Error(`${name}.${propertyName} is missing from the generated schema`);
    Object.assign(property, patch);
  }
}

function improvePublicSchemas(schemas) {
  const model = "com.apollodeploy.signal.feature";

  documentSchema(schemas, `${model}.email.api.model.SendEmailRequest`, {
    description:
      "Email content and delivery options. `from`, `to`, and `subject` are required, and at least one of `html` or `text` must be supplied.",
    required: ["from", "to", "subject"],
    properties: {
      from: { description: "Sender address. Its domain must be verified in the authenticated project." },
      to: {
        description:
          "Recipient addresses, or one topic (`top_…`) or segment (`seg_…`) identifier. A single string is accepted. Audience sends are capped at 50 resolved recipients and cannot include `cc` or `bcc`.",
      },
      cc: { description: "Carbon-copy recipient addresses. These count toward the project's per-message recipient limit." },
      bcc: { description: "Blind-carbon-copy recipient addresses. These count toward the project's per-message recipient limit." },
      replyTo: { description: "Address that receives replies instead of the sender address." },
      subject: { description: "Email subject. The request is rejected when this field is omitted." },
      html: { description: "HTML body. Supply `html`, `text`, or both." },
      text: { description: "Plain-text body. Supply `html`, `text`, or both." },
      tags: { description: "Caller-defined string labels used to categorize the email." },
      metadata: { description: "Caller-defined string metadata associated with the send." },
      idempotencyKey: {
        description: "Project-scoped key that returns the original send result when the request is retried.",
      },
      testMode: {
        description: "Exercises the send flow without delivering to real recipients. Defaults to `false`.",
        default: false,
      },
      attachments: {
        description:
          "Base64-encoded attachments. The decoded total must fit the configured attachment limit, and the message may contain at most 500 MIME parts including bodies.",
      },
      scheduledAt: {
        description:
          "ISO 8601 send time or `optimal`. Explicit times must be 30 seconds to 30 days in the future; omit to send immediately.",
      },
      deliveryWindow: {
        description:
          "Allowed time window for an `optimal` non-transactional send. Required when optimization may delay the message.",
      },
      sendTimeCategory: {
        description:
          "Delivery category. `transactional` messages are never delayed by optimal-time scheduling. Defaults to `transactional`.",
        enum: ["transactional", "marketing", "notification", "digest"],
        default: "transactional",
      },
      trackingSettings: { description: "Per-message overrides for the project's tracking settings." },
    },
  });
  documentSchema(schemas, `${model}.email.api.model.AttachmentRequest`, {
    description: "One MIME attachment encoded inside the JSON request.",
    required: ["filename", "content", "contentType"],
    properties: {
      filename: { description: "File name without path separators or control characters." },
      content: { description: "Valid base64-encoded file content." },
      contentType: { description: "Non-empty MIME type for the attachment." },
      disposition: {
        description: "MIME disposition: `attachment` (default) or `inline`.",
        enum: ["attachment", "inline"],
        default: "attachment",
      },
      contentId: { description: "Optional Content-ID used to reference an inline attachment from HTML." },
    },
  });
  documentSchema(schemas, `${model}.email.api.model.DeliveryWindowRequest`, {
    description: "ISO 8601 bounds used by optimal-time scheduling.",
    properties: {
      start: { description: "Inclusive ISO 8601 start of the delivery window.", format: "date-time" },
      end: { description: "Inclusive ISO 8601 end of the delivery window.", format: "date-time" },
    },
  });
  documentSchema(schemas, `${model}.email.api.model.TrackingSettingsRequest`, {
    description: "Optional tracking overrides for one message; omitted fields inherit project settings.",
    properties: {
      openTracking: { description: "Enable or disable open-pixel tracking for this message." },
      clickTracking: { description: "Enable or disable tracked-link rewriting for this message." },
      unsubscribeTracking: { description: "Enable or disable unsubscribe-link handling for this message." },
      readEngagement: { description: "Enable or disable read-engagement tracking for this message." },
    },
  });
  documentSchema(schemas, `${model}.email.api.model.BatchSendRequest`, {
    description: "Up to 100 independent email send requests.",
    properties: {
      items: {
        description: "Email requests processed independently and returned in input order.",
        maxItems: 100,
      },
    },
  });
  documentSchema(schemas, `${model}.email.api.model.ValidateLinksRequest`, {
    description: "HTML whose links Apollo Signal should probe.",
    properties: {
      html: { description: "HTML content. Each discovered link is returned with its validation result." },
    },
  });

  documentSchema(schemas, `${model}.suppression.api.model.AddSuppressionBody`, {
    description: "Address to suppress manually for this project.",
    properties: {
      email: { description: "Email address to normalize and add with reason `manual`.", format: "email" },
    },
  });
  documentSchema(schemas, `${model}.suppression.api.model.SuppressionImportBody`, {
    description: "Suppression rows to import in one request.",
    properties: {
      suppressions: { description: "Rows to normalize and insert; invalid or duplicate rows are counted as skipped." },
    },
  });
  documentSchema(schemas, `${model}.suppression.api.model.SuppressionImportRowSerializable`, {
    description: "One suppression import row.",
    properties: {
      email: { description: "Email address to suppress.", format: "email" },
      reason: {
        description: "Suppression source. Defaults to `manual` when omitted.",
        enum: ["bounce", "complaint", "manual", "unsubscribe"],
        default: "manual",
      },
    },
  });

  documentSchema(schemas, `${model}.segment.api.model.CreateSegmentBody`, {
    description: "Definition for a new project segment.",
    properties: { name: { description: "Developer-facing segment name." } },
  });

  documentSchema(schemas, `${model}.topic.api.model.CreateTopicBody`, {
    description: "Definition and default consent behavior for a new topic.",
    properties: {
      name: { description: "Topic name after trimming; 1 to 200 characters.", maxLength: 200 },
      defaultSubscription: {
        description: "State assigned when a contact has no explicit preference for this topic.",
        enum: ["opt_in", "opt_out"],
      },
      description: { description: "Optional developer-facing explanation of the topic." },
      visibility: {
        description: "Topic visibility. Defaults to `private`.",
        enum: ["public", "private"],
        default: "private",
      },
    },
  });
  documentSchema(schemas, `${model}.topic.api.model.UpdateTopicBody`, {
    description: "Topic fields to replace; omitted fields remain unchanged.",
    properties: {
      name: { description: "New topic name after trimming; 1 to 200 characters.", maxLength: 200 },
      description: { description: "New developer-facing topic description." },
      visibility: { description: "New topic visibility.", enum: ["public", "private"] },
    },
  });

  documentSchema(schemas, `${model}.contactproperty.api.model.CreateContactPropertyBody`, {
    description: "Custom contact-field definition. Keys and types cannot be changed after creation.",
    properties: {
      key: {
        description: "Project-unique alphanumeric or underscore key, up to 50 characters.",
        maxLength: 50,
        pattern: "^[A-Za-z0-9_]+$",
      },
      type: { description: "Value type accepted for the property.", enum: ["string", "number"] },
      fallbackValue: { description: "Optional value returned when a contact has no value for this property." },
    },
  });
  documentSchema(schemas, `${model}.contactproperty.api.model.UpdateContactPropertyBody`, {
    description: "Replacement fallback value for a contact property.",
    properties: {
      fallbackValue: { description: "New fallback value. Send `null` to clear the existing fallback." },
    },
  });

  documentSchema(schemas, `${model}.contact.api.model.CreateContactBody`, {
    description: "Contact profile, custom fields, and initial audience memberships.",
    required: ["email"],
    properties: {
      email: { description: "Project-unique contact email address.", format: "email" },
      phone: { description: "Optional phone number stored on the contact profile." },
      firstName: { description: "Optional contact first name." },
      lastName: { description: "Optional contact last name." },
      unsubscribed: {
        description: "Whether the contact is globally unsubscribed. Defaults to `false`.",
        default: false,
      },
      properties: {
        description: "Custom property key/value pairs for this project. Defaults to an empty object.",
        default: {},
      },
      segments: {
        description: "Segments to join when the contact is created. Defaults to an empty list.",
        default: [],
      },
      topics: {
        description: "Explicit topic preferences to set at creation. Defaults to an empty list.",
        default: [],
      },
    },
  });
  documentSchema(schemas, `${model}.contact.api.model.UpdateContactBody`, {
    description: "Mutable contact fields; the email address cannot be changed.",
    properties: {
      firstName: { description: "Replacement first name." },
      lastName: { description: "Replacement last name." },
      phone: { description: "Replacement phone number." },
      unsubscribed: { description: "Replacement global unsubscribe state." },
      properties: { description: "Replacement custom property map." },
    },
  });
  documentSchema(schemas, `${model}.contact.api.model.SegmentRef`, {
    description: "Reference to a segment in the same project.",
    properties: { id: { description: "Segment identifier (`seg_…`)." } },
  });
  documentSchema(schemas, `${model}.contact.api.model.TopicSubscriptionBody`, {
    description: "Explicit subscription preference for one project topic.",
    properties: {
      id: { description: "Topic identifier (`top_…`)." },
      subscription: { description: "Contact's preference for the topic.", enum: ["opt_in", "opt_out"] },
    },
  });
  documentSchema(schemas, `${model}.contact.api.model.SetImageUrlBody`, {
    description: "Externally hosted profile image to associate with the contact.",
    properties: {
      url: { description: "Fully qualified HTTPS image URL. The remote resource is not fetched for validation.", format: "uri" },
    },
  });
  documentSchema(schemas, `${model}.contact.api.model.AddToSegmentBody`, {
    description: "Segment membership to create for this contact.",
    properties: { segmentId: { description: "Segment identifier (`seg_…`) in the same project." } },
  });
  documentSchema(schemas, `${model}.contact.api.model.UpdateTopicsBody`, {
    description: "Topic preferences to upsert; topics omitted from the list remain unchanged.",
    properties: { topics: { description: "Topic identifiers and their new explicit preferences." } },
  });
  documentSchema(schemas, `${model}.contact.api.model.RecordValidationBody`, {
    description: "Latest email-validation result for a contact.",
    properties: {
      status: { description: "Validation classification." },
      reason: { description: "Optional provider or policy explanation for the classification." },
    },
  });
  documentSchema(schemas, `${model}.contact.api.model.EmailValidationStatusInput`, {
    description: "Email-validation classification accepted by the API.",
    enum: ["valid", "risky", "invalid", "unknown"],
  });

  documentSchema(schemas, `${model}.webhook.api.model.CreateWebhookBody`, {
    description: "Webhook destination, subscribed event types, and optional payload processing rules.",
    properties: {
      url: { description: "Public HTTPS delivery URL. Localhost and blocked private-network targets are rejected.", format: "uri" },
      events: { description: "Event types delivered to this endpoint.", items: { type: "string", enum: WEBHOOK_EVENTS } },
      name: { description: "Human-readable endpoint name. Signal generates one when omitted." },
      secret: {
        description: "Optional signing secret. Signal generates one when omitted and returns it in the create response.",
      },
      filters: { description: "All filters must match for an event to be delivered." },
      transformations: { description: "Payload transformations applied in list order after filtering." },
    },
  });
  documentSchema(schemas, `${model}.webhook.api.model.UpdateWebhookBody`, {
    description: "Webhook fields to replace; omitted fields remain unchanged.",
    properties: {
      url: { description: "Replacement public HTTPS delivery URL.", format: "uri" },
      events: { description: "Replacement event subscription list.", items: { type: "string", enum: WEBHOOK_EVENTS } },
      name: { description: "Replacement endpoint name." },
      secret: { description: "Replacement signing secret used for subsequent deliveries." },
      enabled: { description: "Whether Signal should attempt new deliveries to this endpoint." },
      filters: { description: "Replacement filter list." },
      transformations: { description: "Replacement ordered transformation list." },
    },
  });
  documentSchema(schemas, `${model}.webhook.api.model.WebhookFilterSerializable`, {
    description: "Predicate evaluated against a dot-delimited field in the canonical event payload.",
    properties: {
      field: { description: "Dot-delimited payload field path." },
      operator: { description: "Comparison to apply.", enum: ["eq", "neq", "contains", "exists"] },
      value: { description: "Comparison value. Omit for the `exists` operator." },
    },
  });
  documentSchema(schemas, `${model}.webhook.api.model.WebhookTransformationSerializable`, {
    description:
      "One payload mutation. Required companion fields depend on `type`: `from` and `to` for rename; `field` for add/remove; `field` and `template` for compute.",
    properties: {
      type: {
        description: "Transformation kind.",
        enum: ["rename_field", "add_field", "remove_field", "compute_field"],
      },
      from: { description: "Source field path for `rename_field`." },
      to: { description: "Destination field path for `rename_field`." },
      field: { description: "Target field path for add, remove, or compute transformations." },
      value: { description: "Value assigned by `add_field`; `null` is allowed." },
      template: { description: "Mustache-style template evaluated by `compute_field`, for example `{{data.firstName}}`." },
    },
  });

  documentSchema(schemas, `${model}.project.api.model.UpdateProjectRequest`, {
    description: "Project identity, limit, and tracking fields to replace; omitted fields remain unchanged.",
    properties: {
      name: { description: "Replacement project name." },
      slug: { description: "Replacement project slug." },
      limits: { description: "Complete replacement for the project's operational limits." },
      trackingSettings: { description: "Complete replacement for project-level tracking defaults." },
    },
  });
  documentSchema(schemas, `${model}.project.api.model.ProjectLimitsModel`, {
    description: "Operational limits applied to the project. Supply every field when replacing limits.",
    properties: {
      dailySends: { description: "Maximum non-test sends admitted per day." },
      perSecondSends: { description: "Maximum sends admitted per second." },
      maxRecipientsPerMessage: { description: "Maximum distinct `to`, `cc`, and `bcc` recipients per message." },
      maxDomains: { description: "Maximum sending domains registered to the project." },
      maxApiKeys: { description: "Maximum API keys available to the project." },
      maxWebhooks: { description: "Maximum webhook endpoints available to the project." },
    },
  });
  documentSchema(schemas, `${model}.project.api.model.ProjectTrackingSettingsModel`, {
    description: "Project defaults for email tracking. Supply every field except `scrollDepth` when replacing settings.",
    required: ["openTracking", "clickTracking", "unsubscribeTracking", "readEngagement"],
    properties: {
      openTracking: { description: "Enable open-pixel tracking by default." },
      clickTracking: { description: "Enable tracked-link rewriting by default." },
      unsubscribeTracking: { description: "Enable unsubscribe-link handling by default." },
      readEngagement: { description: "Enable read-engagement tracking by default." },
      scrollDepth: { description: "Enable scroll-depth tracking by default. Defaults to `false`.", default: false },
    },
  });

  documentSchema(schemas, `${model}.domains.api.model.RegisterDomainRequest`, {
    description: "Sending-domain hostname and AWS region.",
    properties: {
      domain: { description: "Domain hostname without a scheme or path. Signal normalizes it before registration." },
      region: { description: "AWS region in which Signal provisions the domain identity.", enum: SIGNAL_REGIONS },
    },
  });
  documentSchema(schemas, `${model}.domains.api.model.UpdateBimiRequest`, {
    description: "BIMI logo configuration. Updating it returns the domain to `pending` verification.",
    properties: {
      logoUrl: { description: "URL of the BIMI-compatible SVG logo to associate with the domain.", format: "uri" },
    },
  });
}

function validateRequestSchemas(paths, schemas) {
  const names = new Set();
  for (const pathItem of Object.values(paths)) {
    for (const operation of Object.values(pathItem)) {
      collectSchemaRefs(operation.requestBody, names);
    }
  }
  const queue = [...names];
  while (queue.length > 0) {
    const name = queue.shift();
    const schema = schemas[name];
    if (!schema) throw new Error(`Request schema is missing: ${name}`);
    for (const [propertyName, property] of Object.entries(schema.properties ?? {})) {
      if (!property.description) throw new Error(`${name}.${propertyName} lacks a description`);
    }
    for (const dependency of collectSchemaRefs(schema)) {
      if (!names.has(dependency)) {
        names.add(dependency);
        queue.push(dependency);
      }
    }
  }
}

function navigationEndpoints(docsConfig) {
  const endpoints = new Set();
  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    } else if (typeof value === "string" && /^(GET|POST|PUT|PATCH|DELETE) \/v1\//.test(value)) {
      endpoints.add(value);
    }
  }
  visit(docsConfig.navigation);
  return endpoints;
}

function validateNavigation(routes, docsConfig) {
  const expected = new Set(routes.map((route) => `${route.method.toUpperCase()} ${route.path}`));
  const actual = navigationEndpoints(docsConfig);
  const missing = [...expected].filter((endpoint) => !actual.has(endpoint));
  const unexpected = [...actual].filter((endpoint) => !expected.has(endpoint));
  if (missing.length || unexpected.length) {
    throw new Error(
      `API navigation is out of sync. Missing: ${missing.join(", ") || "none"}. ` +
        `Unexpected: ${unexpected.join(", ") || "none"}.`,
    );
  }
}

function buildSpec(source, manifest, docsConfig) {
  const routes = publicRoutes(manifest);
  const seen = new Set();
  const paths = {};

  for (const route of routes) {
    if (!route.operationId) throw new Error(`${route.method.toUpperCase()} ${route.path} has no operationId`);
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) throw new Error(`Duplicate public operation: ${key}`);
    seen.add(key);
    if (!HTTP_METHODS.has(route.method)) throw new Error(`Unsupported HTTP method: ${route.method}`);
    const sourceOperation = source.paths?.[route.path]?.[route.method];
    if (!sourceOperation) {
      throw new Error(`OpenAPI is missing public operation ${route.method.toUpperCase()} ${route.path}`);
    }
    paths[route.path] ??= {};
    paths[route.path][route.method] = enrichOperation(sourceOperation, route);
  }

  validateNavigation(routes, docsConfig);
  const schemas = reachableSchemas(paths, source.components?.schemas ?? {});
  improvePublicSchemas(schemas);
  validateRequestSchemas(paths, schemas);

  for (const [routePath, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!operation.summary || !operation.description) {
        throw new Error(`${method.toUpperCase()} ${routePath} is missing summary or description`);
      }
      for (const parameter of operation.parameters ?? []) {
        if (!parameter.description) {
          throw new Error(`${method.toUpperCase()} ${routePath} parameter ${parameter.name} lacks a description`);
        }
      }
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!response.description) {
          throw new Error(`${method.toUpperCase()} ${routePath} response ${status} lacks a description`);
        }
      }
    }
  }

  return {
    openapi: source.openapi,
    info: {
      title: "Apollo Signal API",
      version: source.info?.version ?? "1.0.0",
      description:
        "Public REST API for transactional email, contacts, audiences, webhooks, metrics, projects, and sending domains.",
    },
    servers: [{ url: "https://api.signal.apollodeploy.com", description: "Production" }],
    tags: Object.values(TAGS),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Project-bound Apollo Signal API key. Keys begin with `ap_signal_` and must carry the permission shown on the operation.",
        },
        streamTokenAuth: {
          type: "apiKey",
          in: "query",
          name: "token",
          description: "One-time, 60-second token issued by the email stream-token endpoint.",
        },
      },
      schemas,
    },
    "x-public-operation-count": routes.length,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const openApiPath =
    options.openApiPath ?? path.join(options.apiRoot, "src/main/resources/openapi/documentation.json");
  const manifestPath = options.manifestPath ?? path.join(options.apiRoot, "build/docs-manifest.json");
  const source = readJson(openApiPath, "Generate the API OpenAPI artifact first.");
  const manifest = readJson(
    manifestPath,
    "From the API checkout, run the TESSERACT_GENERATE command documented in this app's README.",
  );
  const docsConfig = readJson(DOCS_CONFIG_PATH, "Restore the Mintlify site configuration.");
  const spec = buildSpec(source, manifest, docsConfig);
  const rendered = `${JSON.stringify(spec, null, 2)}\n`;

  if (options.check) {
    if (!fs.existsSync(OUTPUT_PATH) || fs.readFileSync(OUTPUT_PATH, "utf8") !== rendered) {
      throw new Error("signal/api-reference/openapi.json is stale; run npm run generate:signal-api");
    }
    console.log(`Apollo Signal API reference is current (${spec["x-public-operation-count"]} public operations).`);
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, rendered);
  console.log(
    `Generated signal/api-reference/openapi.json with ${spec["x-public-operation-count"]} public operations.`,
  );
}

main();
