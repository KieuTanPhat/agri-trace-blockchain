export interface paths {
    "/api": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AppController_getHello"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in and revoke the previous browser session
         * @description Sets an HttpOnly session selector and a refresh cookie named agritrace_refresh_<sessionId>. Send both cookies on refresh/logout. Refresh responses only update their own family cookie.
         */
        post: operations["AuthController_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Revoke all tokens in the selected session family
         * @description Without session cookies this is a successful no-op. With cookies, clears only this family cookie. The selector is intentionally not changed by refresh/logout, so a late response cannot replace or clear a newer login.
         */
        post: operations["AuthController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController_getProfile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate the selected refresh session
         * @description Requires the selector and its HttpOnly family cookie. A concurrent rotation returns 409 without clearing cookies; retry after the winning response updates the cookie.
         */
        post: operations["AuthController_refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/blockchain/events/{eventId}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BlockchainController_verify"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CatalogController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/farms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CatalogController_farm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/plots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CatalogController_plot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CatalogController_product"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/certificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ComplianceController_certificates"];
        put?: never;
        post: operations["ComplianceController_createCertificate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/certificates/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["ComplianceController_reviewCertificate"];
        trace?: never;
    };
    "/api/compliance/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ComplianceAssignmentsController_list"];
        put?: never;
        post: operations["ComplianceAssignmentsController_grant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/compliance/assignments/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ComplianceAssignmentsController_revoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LotsController_dashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_check"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/inspections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ComplianceController_inspections"];
        put?: never;
        post: operations["ComplianceController_createInspection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/iot/cycles/{cycleId}/digests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IotController_createSensorDigest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/iot/device-readings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IotController_ingestForDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/iot/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["IotController_devices"];
        put?: never;
        post: operations["IotController_createDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/iot/readings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IotController_ingestForUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/iot/shipments/{shipmentId}/device-telemetry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IotController_ingestTelemetryForDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/iot/shipments/{shipmentId}/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IotController_bindShipmentDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/iot/shipments/{shipmentId}/devices/{deviceId}/unbind": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IotController_unbindShipmentDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/iot/shipments/{shipmentId}/telemetry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IotController_ingestTelemetryForUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/iot/shipments/{shipmentId}/telemetry-digests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IotController_createTelemetryDigest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LotsController_getLots"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lots/{lotId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LotsController_getLot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lots/{lotId}/damage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["LotCommandsController_damage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lots/{lotId}/expire": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["LotCommandsController_expire"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lots/{lotId}/mark-for-sale": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["LotCommandsController_markForSale"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lots/{lotId}/mark-sold": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["LotCommandsController_markSold"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lots/{lotId}/recall": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["LotCommandsController_recall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrganizationsController_list"];
        put?: never;
        post: operations["OrganizationsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/organizations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["OrganizationsController_update"];
        trace?: never;
    };
    "/api/production-cycles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProductionCyclesController_list"];
        put?: never;
        post: operations["ProductionCyclesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/production-cycles/{cycleId}/harvests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["LotsController_harvest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/production-cycles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProductionCyclesController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/production-cycles/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProductionCyclesController_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/production-cycles/{id}/care": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProductionCyclesController_care"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/production-cycles/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProductionCyclesController_close"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/production-cycles/{id}/plant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProductionCyclesController_plant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/production-cycles/{id}/sensor-readings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProductionCyclesController_sensor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/production-cycles/{id}/sensor-reconciliations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProductionCyclesController_reconcileSensor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/public/trace/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PublicTraceController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shipments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ShipmentsController_list"];
        put?: never;
        post: operations["ShipmentsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shipments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ShipmentsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shipments/{id}/arrive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShipmentsController_arrive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shipments/{id}/damage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShipmentsController_damage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shipments/{id}/receive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShipmentsController_receive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shipments/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShipmentsController_reject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shipments/{id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShipmentsController_start"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/trace/events/{eventId}/proof": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TraceController_getProof"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/trace/lots/{lotId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TraceController_getLotHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_list"];
        put?: never;
        post: operations["UsersController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["UsersController_updateStatus"];
        trace?: never;
    };
    "/api/users/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_roles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ApiErrorDto: {
            /** @enum {string} */
            code: "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "UNPROCESSABLE_ENTITY" | "DATABASE_CONSTRAINT" | "INTERNAL_ERROR";
            message: string | string[];
        };
        ApiErrorEnvelopeDto: {
            error: components["schemas"]["ApiErrorDto"];
            path: string;
            requestId: string;
            /** @enum {boolean} */
            success: false;
            /** Format: date-time */
            timestamp: string;
        };
        AssignmentListDto: {
            audits: components["schemas"]["ComplianceAssignmentAuditRecordDto"][];
            farm: components["schemas"]["NamedDto"];
            /** Format: uuid */
            farmId: string;
            /** Format: date-time */
            grantedAt: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            reviewerUserId: string;
            /** Format: date-time */
            revokedAt: string | null;
        };
        AssignmentReasonDto: {
            reason: string;
        };
        AuthLogoutResponseDto: {
            data: components["schemas"]["RevocationDto"];
            requestId: string;
            /** @enum {boolean} */
            success: true;
            /** Format: date-time */
            timestamp: string;
        };
        AuthOrganizationDto: {
            status: string;
        };
        AuthProfileResponseDto: {
            data: components["schemas"]["AuthUserDto"];
            requestId: string;
            /** @enum {boolean} */
            success: true;
            /** Format: date-time */
            timestamp: string;
        };
        AuthRoleDto: {
            /** @enum {string} */
            code: "SYSTEM_ADMIN" | "FARM_STAFF" | "IOT_DEVICE" | "TRANSPORTER" | "RETAILER" | "AUDITOR" | "COMPLIANCE_REVIEWER" | "SYSTEM_ACTOR";
            /** Format: uuid */
            id: string;
            name: string;
        };
        AuthSessionDto: {
            accessToken: string;
            /**
             * Format: uuid
             * @description Refresh session family identifier; not a credential
             */
            sessionId: string;
            /** @enum {string} */
            tokenType: "Bearer";
            user: components["schemas"]["AuthUserDto"];
        };
        AuthSessionResponseDto: {
            data: components["schemas"]["AuthSessionDto"];
            requestId: string;
            /** @enum {boolean} */
            success: true;
            /** Format: date-time */
            timestamp: string;
        };
        AuthUserDto: {
            accountStatus: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: email */
            email: string;
            fullName: string;
            /** Format: uuid */
            id: string;
            organization: components["schemas"]["AuthOrganizationDto"] | (never | null);
            /** Format: uuid */
            organizationId: string | null;
            role: components["schemas"]["AuthRoleDto"];
            /** Format: date-time */
            updatedAt: string;
        };
        BindShipmentDeviceDto: {
            /** Format: uuid */
            deviceId: string;
            note?: string | null;
        };
        BlockchainOutboxRecordDto: {
            attemptCount: number;
            /** Format: date-time */
            completedAt: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            eventId: string;
            /** Format: uuid */
            id: string;
            lastError: string | null;
            /** Format: date-time */
            leaseExpiresAt: string | null;
            /** Format: uuid */
            leaseToken: string | null;
            /** Format: date-time */
            nextAttemptAt: string | null;
            /** @enum {string} */
            status: "PENDING" | "PROCESSING" | "RETRY" | "COMPLETED" | "DEAD_LETTER";
            /** Format: date-time */
            updatedAt: string;
        };
        BlockchainProofRecordDto: {
            attemptCount: number;
            channelId: string;
            /** Format: date-time */
            createdAt: string;
            dataHash: string;
            /** Format: uuid */
            eventId: string;
            /** Format: uuid */
            id: string;
            lastError: string | null;
            network: string;
            /** Format: date-time */
            nextAttemptAt: string | null;
            /** Format: date-time */
            recordedAt: string | null;
            relayerAddress: string | null;
            /** @enum {string} */
            transactionStatus: "PENDING" | "CONFIRMED" | "FAILED";
            txId: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        CancelCycleDto: {
            reason: string;
            version: number;
        };
        CareRecordDto: {
            careType: string;
            /** Format: date-time */
            eventTime: string;
            materialName?: string | null;
            method?: string | null;
            note?: string | null;
            quantity?: number | null;
            unit?: string | null;
            version: number;
        };
        CareRecordRecordDto: {
            activeIngredient: string | null;
            applicationArea: string | null;
            careType: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            cycleId: string;
            /** Format: date-time */
            eventTime: string;
            evidenceRef: string | null;
            /** Format: uuid */
            id: string;
            materialName: string | null;
            method: string | null;
            note: string | null;
            /** @description Exact decimal serialized as a string */
            quantity: string | null;
            unit: string | null;
            withdrawalPeriod: number | null;
        };
        CareResultDto: {
            care: components["schemas"]["CareRecordRecordDto"];
            version: number;
        };
        CatalogDto: {
            farms: components["schemas"]["CatalogFarmDto"][];
            plots: components["schemas"]["CatalogPlotDto"][];
            products: components["schemas"]["ProductRecordDto"][];
        };
        CatalogFarmDto: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            location: string | null;
            name: string;
            organization: components["schemas"]["OrganizationRecordDto"];
            /** Format: uuid */
            organizationId: string;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            /** Format: date-time */
            updatedAt: string;
        };
        CatalogPlotDto: {
            /** @description Exact decimal serialized as a string */
            area: string | null;
            /** Format: date-time */
            createdAt: string;
            farm: components["schemas"]["FarmRecordDto"];
            /** Format: uuid */
            farmId: string;
            /** Format: uuid */
            id: string;
            location: string | null;
            name: string;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            unit: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        CertificateRecordDto: {
            correctionReason: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            cycleId: string | null;
            documentHash: string;
            documentRef: string;
            /** Format: date-time */
            expiryDate: string | null;
            /** Format: uuid */
            id: string;
            isPublic: boolean;
            /** Format: date-time */
            issueDate: string;
            issuer: string;
            /** Format: uuid */
            lotId: string | null;
            /** Format: date-time */
            reviewedAt: string | null;
            /** Format: uuid */
            reviewedBy: string | null;
            reviewNote: string | null;
            status: string;
            /** Format: uuid */
            submittedByUserId: string | null;
            /** Format: uuid */
            supersedesId: string | null;
            type: string;
            version: number;
        };
        ComplianceAssignmentAuditRecordDto: {
            action: string;
            /** Format: uuid */
            actorUserId: string;
            /** Format: uuid */
            assignmentId: string;
            /** Format: uuid */
            id: string;
            reason: string;
            /** Format: date-time */
            recordedAt: string;
        };
        ComplianceAssignmentRecordDto: {
            /** Format: uuid */
            farmId: string;
            /** Format: date-time */
            grantedAt: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            reviewerUserId: string;
            /** Format: date-time */
            revokedAt: string | null;
        };
        CreateCertificateDto: {
            correctionReason?: string | null;
            /** Format: uuid */
            cycleId?: string | null;
            documentHash: string;
            documentRef: string;
            /**
             * @description YYYY-MM-DD or ISO 8601 timestamp with timezone; normalized to the Vietnam calendar date
             * @example 2026-10-13
             */
            expiryDate?: string | null;
            isPublic?: boolean | null;
            /**
             * @description YYYY-MM-DD or ISO 8601 timestamp with timezone; normalized to the Vietnam calendar date
             * @example 2026-10-13
             */
            issueDate: string;
            issuer: string;
            /** Format: uuid */
            lotId?: string | null;
            /** Format: uuid */
            supersedesId?: string | null;
            type: string;
        };
        CreateInspectionDto: {
            correctionReason?: string | null;
            evidenceRef?: string | null;
            /** Format: date-time */
            inspectedAt: string;
            /** Format: uuid */
            lotId: string;
            note?: string | null;
            /** @enum {string} */
            result: "PASS" | "FAIL" | "CONDITIONAL";
            /** Format: uuid */
            supersedesId?: string | null;
        };
        CreateIotDeviceDto: {
            /** Format: uuid */
            cycleId?: string | null;
            deviceCode: string;
            name: string;
            /** Format: uuid */
            organizationId: string;
            type: string;
        };
        CreateOrganizationDto: {
            name: string;
            /** @enum {string} */
            type: "FARM" | "TRANSPORTER" | "RETAILER" | "AUDITOR";
        };
        CreateProductionCycleDto: {
            cycleCode: string;
            /** Format: uuid */
            farmId: string;
            harvestUnit: string;
            maxHarvestQuantity: number;
            note?: string | null;
            /**
             * @description YYYY-MM-DD or ISO 8601 timestamp with timezone; normalized to the Vietnam calendar date
             * @example 2026-10-13
             */
            plannedHarvest?: string | null;
            /** Format: uuid */
            plotId?: string | null;
            /** Format: uuid */
            productId: string;
            /**
             * @description YYYY-MM-DD or ISO 8601 timestamp with timezone; normalized to the Vietnam calendar date
             * @example 2026-10-13
             */
            startDate?: string | null;
        };
        CreateSensorDigestDto: {
            isFinal?: boolean | null;
            /** Format: date-time */
            periodEnd: string;
            /** Format: date-time */
            periodStart: string;
        };
        CreateShipmentDto: {
            destination: string;
            /** Format: date-time */
            expectedArrivalTime?: string | null;
            /** Format: uuid */
            lotId: string;
            origin: string;
            /** Format: date-time */
            plannedPickupTime?: string | null;
            /** Format: uuid */
            retailerOrgId: string;
            /** Format: uuid */
            transporterOrgId: string;
            vehicleRef?: string | null;
        };
        CreateTelemetryDigestDto: {
            isFinal?: boolean | null;
            /** Format: date-time */
            periodEnd: string;
            /** Format: date-time */
            periodStart: string;
        };
        CreateUserDto: {
            /** Format: email */
            email: string;
            fullName: string;
            /** Format: uuid */
            organizationId?: string | null;
            password: string;
            roleCode: string;
        };
        CustodianDto: {
            /** Format: uuid */
            organizationId: string;
            /** @enum {string} */
            role: "FARM_STAFF" | "TRANSPORTER" | "RETAILER";
        };
        CycleDetailDto: {
            careRecords: components["schemas"]["CareRecordRecordDto"][];
            certificates: components["schemas"]["CertificateRecordDto"][];
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            currentState: "CREATED" | "PLANTED" | "GROWING" | "COMPLETED" | "CANCELLED";
            cycleCode: string;
            farm: components["schemas"]["FarmRecordDto"];
            /** Format: uuid */
            farmId: string;
            /** Format: uuid */
            farmOrgId: string;
            harvestEvents: components["schemas"]["HarvestDetailDto"][];
            harvestUnit: string | null;
            /** Format: uuid */
            id: string;
            /** @description Exact decimal serialized as a string */
            maxHarvestQuantity: string | null;
            note: string | null;
            /** Format: date-time */
            plannedHarvest: string | null;
            plot: components["schemas"]["PlotRecordDto"] | (never | null);
            /** Format: uuid */
            plotId: string | null;
            product: components["schemas"]["ProductRecordDto"];
            /** Format: uuid */
            productId: string;
            sensorDigests: components["schemas"]["SensorDigestRecordDto"][];
            sensorReadings: components["schemas"]["SensorReadingRecordDto"][];
            /** Format: date-time */
            startDate: string | null;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        CycleListDto: {
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            currentState: "CREATED" | "PLANTED" | "GROWING" | "COMPLETED" | "CANCELLED";
            cycleCode: string;
            farm: components["schemas"]["NamedDto"];
            /** Format: uuid */
            farmId: string;
            /** Format: uuid */
            farmOrgId: string;
            harvestUnit: string | null;
            /** Format: uuid */
            id: string;
            /** @description Exact decimal serialized as a string */
            maxHarvestQuantity: string | null;
            note: string | null;
            /** Format: date-time */
            plannedHarvest: string | null;
            plot: components["schemas"]["NamedDto"] | (never | null);
            /** Format: uuid */
            plotId: string | null;
            product: components["schemas"]["ProductOptionDto"];
            /** Format: uuid */
            productId: string;
            /** Format: date-time */
            startDate: string | null;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        CycleOptionDto: {
            /** @enum {string} */
            currentState: "CREATED" | "PLANTED" | "GROWING" | "COMPLETED" | "CANCELLED";
            cycleCode: string;
            /** Format: uuid */
            id: string;
        };
        CycleSensorReconciliationRecordDto: {
            /** Format: date-time */
            cutoffEnd: string | null;
            /** Format: uuid */
            cycleId: string;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            plantedAt: string;
            reason: string;
            /** Format: date-time */
            recordedAt: string;
            /** Format: uuid */
            recordedById: string;
            revision: number;
            /** Format: uuid */
            throughHarvestId: string | null;
        };
        CycleSummaryDto: {
            /** @enum {string} */
            currentState: "CREATED" | "PLANTED" | "GROWING" | "COMPLETED" | "CANCELLED";
            cycleCode: string;
            /** Format: uuid */
            cycleId: string;
            /** Format: date-time */
            startDate: string | null;
        };
        DamageLotDto: {
            evidenceRef?: string | null;
            quantity: number;
            reason: string;
            /** @description Required when the Lot has a Shipment */
            shipmentVersion?: number | null;
            version: number;
        };
        DamageShipmentDto: {
            evidenceRef?: string | null;
            lotVersion: number;
            /** Format: date-time */
            occurredAt?: string | null;
            quantity: number;
            reason: string;
            version: number;
        };
        DashboardDto: {
            featuredLot: components["schemas"]["InternalLotDto"] | (never | null);
            stats: components["schemas"]["DashboardStatDto"][];
        };
        DashboardStatDto: {
            label: string;
            value: string;
        };
        DetailShipmentLotDto: {
            /** @description Exact decimal serialized as a string */
            availableQuantity: string;
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            currentState: "HARVESTED" | "IN_TRANSPORT" | "ARRIVED" | "RETAIL_RECEIVED" | "FOR_SALE" | "SOLD" | "RECALLED" | "EXPIRED" | "DAMAGED" | "REJECTED";
            /** Format: date-time */
            expiryDate: string | null;
            /** Format: uuid */
            farmOrgId: string;
            grade: string | null;
            /** Format: uuid */
            harvestId: string;
            /** Format: uuid */
            id: string;
            /** @description Exact decimal serialized as a string */
            initialQuantity: string;
            lineageType: string | null;
            lotCode: string;
            organization: components["schemas"]["OrganizationRecordDto"];
            /** Format: uuid */
            parentLotId: string | null;
            product: components["schemas"]["ProductRecordDto"];
            /** Format: uuid */
            productId: string;
            unit: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        DeviceListDto: {
            /** Format: date-time */
            createdAt: string;
            cycle: components["schemas"]["CycleOptionDto"] | (never | null);
            /** Format: uuid */
            cycleId: string | null;
            deviceCode: string;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            lastSeenAt: string | null;
            name: string;
            organization: components["schemas"]["OrgDto"];
            /** Format: uuid */
            organizationId: string;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            type: string;
            /** Format: date-time */
            updatedAt: string;
        };
        FarmDto: {
            location?: string | null;
            name: string;
            /** Format: uuid */
            organizationId: string;
        };
        FarmRecordDto: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            location: string | null;
            name: string;
            /** Format: uuid */
            organizationId: string;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            /** Format: date-time */
            updatedAt: string;
        };
        GrantAssignmentDto: {
            /** Format: uuid */
            farmId: string;
            reason: string;
            /** Format: uuid */
            reviewerUserId: string;
        };
        HarvestDetailDto: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            cycleId: string;
            /** Format: uuid */
            finalSensorDigestId: string | null;
            grade: string | null;
            harvestArea: string | null;
            /** Format: date-time */
            harvestTime: string;
            /** Format: uuid */
            id: string;
            lot: components["schemas"]["HarvestLotDto"] | (never | null);
            qualityNote: string | null;
            /** @description Exact decimal serialized as a string */
            quantity: string;
            sensorWindow: components["schemas"]["HarvestSensorWindowRecordDto"] | (never | null);
            unit: string;
        };
        HarvestEventRecordDto: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            cycleId: string;
            /** Format: uuid */
            finalSensorDigestId: string | null;
            grade: string | null;
            harvestArea: string | null;
            /** Format: date-time */
            harvestTime: string;
            /** Format: uuid */
            id: string;
            qualityNote: string | null;
            /** @description Exact decimal serialized as a string */
            quantity: string;
            unit: string;
        };
        HarvestLotDto: {
            /** @description Exact decimal serialized as a string */
            availableQuantity: string;
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            currentState: "HARVESTED" | "IN_TRANSPORT" | "ARRIVED" | "RETAIL_RECEIVED" | "FOR_SALE" | "SOLD" | "RECALLED" | "EXPIRED" | "DAMAGED" | "REJECTED";
            /** Format: date-time */
            expiryDate: string | null;
            /** Format: uuid */
            farmOrgId: string;
            grade: string | null;
            /** Format: uuid */
            harvestId: string;
            /** Format: uuid */
            id: string;
            /** @description Exact decimal serialized as a string */
            initialQuantity: string;
            lineageType: string | null;
            lotCode: string;
            /** Format: uuid */
            parentLotId: string | null;
            /** Format: uuid */
            productId: string;
            shipment: components["schemas"]["ShipmentRecordDto"] | (never | null);
            unit: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        HarvestResultDto: {
            cycleVersion: number;
            harvest: components["schemas"]["HarvestEventRecordDto"];
            lot: components["schemas"]["LotRecordDto"];
            sensorWindow: components["schemas"]["HarvestSensorWindowRecordDto"];
            traceQr: components["schemas"]["TraceQrRecordDto"];
        };
        HarvestSensorWindowRecordDto: {
            /** Format: uuid */
            cycleId: string;
            digestHash: string | null;
            /** Format: date-time */
            finalizedAt: string;
            /** Format: uuid */
            harvestId: string;
            /** Format: uuid */
            id: string;
            includeStart: boolean;
            /** Format: date-time */
            periodEnd: string;
            /** Format: date-time */
            periodStart: string;
            readingCount: number;
            /** Format: uuid */
            reconciliationId: string | null;
            schemaVersion: string;
            /** Format: date-time */
            sealedAt: string | null;
            status: string;
        };
        HealthDto: {
            service: string;
            /** @enum {string} */
            status: "ok";
            /** Format: date-time */
            timestamp: string;
        };
        IngestSensorReadingDto: {
            /** Format: uuid */
            cycleId: string;
            deviceId: string;
            /** Format: date-time */
            recordedAt: string;
            sensorType: string;
            unit: string;
            value: number;
        };
        IngestShipmentTelemetryDto: {
            accuracy?: number | null;
            battery?: number | null;
            deviceId: string;
            deviceSequence?: number | null;
            heading?: number | null;
            humidity?: number | null;
            latitude: number;
            longitude: number;
            /** Format: date-time */
            recordedAt: string;
            speed?: number | null;
            temperature?: number | null;
        };
        InspectionListDto: {
            correctionReason: string | null;
            /** Format: date-time */
            createdAt: string;
            evidenceRef: string | null;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            inspectedAt: string;
            /** Format: uuid */
            inspectorOrgId: string | null;
            lot: components["schemas"]["LotOptionDto"];
            /** Format: uuid */
            lotId: string;
            note: string | null;
            organization: components["schemas"]["OrgDto"] | (never | null);
            /** Format: uuid */
            recordedByUserId: string | null;
            /** @enum {string} */
            result: "PASS" | "FAIL" | "CONDITIONAL";
            /** Format: uuid */
            supersedesId: string | null;
        };
        InspectionRecordDto: {
            correctionReason: string | null;
            /** Format: date-time */
            createdAt: string;
            evidenceRef: string | null;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            inspectedAt: string;
            /** Format: uuid */
            inspectorOrgId: string | null;
            /** Format: uuid */
            lotId: string;
            note: string | null;
            /** Format: uuid */
            recordedByUserId: string | null;
            /** @enum {string} */
            result: "PASS" | "FAIL" | "CONDITIONAL";
            /** Format: uuid */
            supersedesId: string | null;
        };
        InternalLotDto: {
            allowedCommands: ("createShipment" | "reportDamage" | "startTransport" | "reportArrival" | "receiveRetail" | "rejectRetail" | "markForSale" | "markSold" | "recall" | "expire")[];
            availableQuantity: number;
            blockchainProof?: components["schemas"]["LotProofDto"];
            /** @enum {string} */
            currentState: "HARVESTED" | "IN_TRANSPORT" | "ARRIVED" | "RETAIL_RECEIVED" | "FOR_SALE" | "SOLD" | "RECALLED" | "EXPIRED" | "DAMAGED" | "REJECTED";
            custodian: components["schemas"]["CustodianDto"] | (never | null);
            damagedQuantity: number;
            /** Format: date */
            expiryDate: string | null;
            farmOrg: components["schemas"]["OrganizationSummaryDto"];
            /** Format: date-time */
            harvestTime: string;
            initialQuantity: number;
            isExpired: boolean;
            lotCode: string;
            /** Format: uuid */
            lotId: string;
            productionCycle: components["schemas"]["CycleSummaryDto"];
            productName: string;
            /** @enum {string} */
            proofStatus: "VERIFIED" | "PENDING" | "INTEGRITY_WARNING" | "BLOCKCHAIN_UNAVAILABLE";
            quantityMovements: components["schemas"]["MovementDto"][];
            quantityReconciled: boolean;
            retailerOrg?: components["schemas"]["OrganizationSummaryDto"];
            sensorEvidence: components["schemas"]["SensorEvidenceDto"];
            shipment?: components["schemas"]["InternalShipmentDto"];
            stateReconciled: boolean;
            timeline: components["schemas"]["InternalTimelineDto"][];
            traceToken?: string;
            unit: string;
            version: number;
            warnings: string[];
        };
        InternalShipmentDto: {
            destination: string;
            origin: string;
            receivedQuantity: number | null;
            rejectedQuantity: number | null;
            /** Format: uuid */
            retailerOrgId: string;
            /** Format: uuid */
            shipmentId: string;
            shippedQuantity: number;
            /** @enum {string} */
            status: "CREATED" | "IN_TRANSIT" | "ARRIVED" | "DELIVERED" | "REJECTED" | "FAILED";
            /** Format: uuid */
            transporterOrgId: string;
            version: number;
        };
        InternalTimelineActorDto: {
            /** Format: uuid */
            organizationId?: string;
            organizationName: string;
            /** @enum {string} */
            role: "SYSTEM_ADMIN" | "FARM_STAFF" | "IOT_DEVICE" | "TRANSPORTER" | "RETAILER" | "AUDITOR" | "COMPLIANCE_REVIEWER" | "SYSTEM_ACTOR";
            /** Format: uuid */
            userId?: string;
        };
        InternalTimelineDto: {
            actor: components["schemas"]["InternalTimelineActorDto"];
            /** @enum {string} */
            entityType: "PRODUCTION_CYCLE" | "CARE" | "SENSOR" | "SENSOR_DIGEST" | "HARVEST" | "LOT" | "SHIPMENT" | "SHIPMENT_TELEMETRY" | "INSPECTION" | "CERTIFICATE";
            /** Format: uuid */
            eventId: string;
            /** Format: date-time */
            eventTime: string;
            eventType: string;
            /** @enum {string} */
            proofStatus: "VERIFIED" | "PENDING" | "INTEGRITY_WARNING" | "BLOCKCHAIN_UNAVAILABLE";
            summary: string;
        };
        IotDeviceRecordDto: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            cycleId: string | null;
            deviceCode: string;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            lastSeenAt: string | null;
            name: string;
            /** Format: uuid */
            organizationId: string;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            type: string;
            /** Format: date-time */
            updatedAt: string;
        };
        ListShipmentLotDto: {
            /** @description Exact decimal serialized as a string */
            availableQuantity: string;
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            currentState: "HARVESTED" | "IN_TRANSPORT" | "ARRIVED" | "RETAIL_RECEIVED" | "FOR_SALE" | "SOLD" | "RECALLED" | "EXPIRED" | "DAMAGED" | "REJECTED";
            /** Format: date-time */
            expiryDate: string | null;
            /** Format: uuid */
            farmOrgId: string;
            grade: string | null;
            /** Format: uuid */
            harvestId: string;
            /** Format: uuid */
            id: string;
            /** @description Exact decimal serialized as a string */
            initialQuantity: string;
            lineageType: string | null;
            lotCode: string;
            organization: components["schemas"]["OrgDto"];
            /** Format: uuid */
            parentLotId: string | null;
            product: components["schemas"]["ProductBriefDto"];
            /** Format: uuid */
            productId: string;
            unit: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        LoginDto: {
            /** Format: email */
            email: string;
            /** Format: password */
            password: string;
        };
        LotCommandResultDto: {
            availableQuantity: number;
            /** @enum {string} */
            currentState: "HARVESTED" | "IN_TRANSPORT" | "ARRIVED" | "RETAIL_RECEIVED" | "FOR_SALE" | "SOLD" | "RECALLED" | "EXPIRED" | "DAMAGED" | "REJECTED";
            /** Format: uuid */
            eventId: string;
            /** Format: uuid */
            lotId: string;
            version: number;
        };
        LotOptionDto: {
            /** @enum {string} */
            currentState: "HARVESTED" | "IN_TRANSPORT" | "ARRIVED" | "RETAIL_RECEIVED" | "FOR_SALE" | "SOLD" | "RECALLED" | "EXPIRED" | "DAMAGED" | "REJECTED";
            /** Format: uuid */
            id: string;
            lotCode: string;
        };
        LotProofDto: {
            dataHash: string;
            network: string;
            /** Format: date-time */
            recordedAt: string | null;
            /** @enum {string} */
            transactionStatus: "PENDING" | "CONFIRMED" | "FAILED";
            txId: string | null;
        };
        LotReasonCommandDto: {
            reason: string;
            /** @description Required when the Lot has a Shipment */
            shipmentVersion?: number | null;
            version: number;
        };
        LotRecordDto: {
            /** @description Exact decimal serialized as a string */
            availableQuantity: string;
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            currentState: "HARVESTED" | "IN_TRANSPORT" | "ARRIVED" | "RETAIL_RECEIVED" | "FOR_SALE" | "SOLD" | "RECALLED" | "EXPIRED" | "DAMAGED" | "REJECTED";
            /** Format: date-time */
            expiryDate: string | null;
            /** Format: uuid */
            farmOrgId: string;
            grade: string | null;
            /** Format: uuid */
            harvestId: string;
            /** Format: uuid */
            id: string;
            /** @description Exact decimal serialized as a string */
            initialQuantity: string;
            lineageType: string | null;
            lotCode: string;
            /** Format: uuid */
            parentLotId: string | null;
            /** Format: uuid */
            productId: string;
            unit: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        LotVersionCommandDto: {
            /** @description Required when the Lot has a Shipment */
            shipmentVersion?: number | null;
            version: number;
        };
        MovementDto: {
            afterQty: number;
            beforeQty: number;
            /** Format: date-time */
            createdAt: string;
            delta: number;
            /** Format: uuid */
            id: string;
            quantity: number;
            type: string;
            unit: string;
        };
        NamedDto: {
            /** Format: uuid */
            id: string;
            name: string;
        };
        OrganizationRecordDto: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            /** @enum {string} */
            type: "FARM" | "TRANSPORTER" | "RETAILER" | "AUDITOR";
            /** Format: date-time */
            updatedAt: string;
        };
        OrganizationSummaryDto: {
            name: string;
            /** Format: uuid */
            organizationId: string;
            /** @enum {string} */
            type: "FARM" | "TRANSPORTER" | "RETAILER" | "AUDITOR";
        };
        OrgDto: {
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            type: "FARM" | "TRANSPORTER" | "RETAILER" | "AUDITOR";
        };
        PlantCycleDto: {
            /** Format: date-time */
            plantedAt: string;
            version: number;
        };
        PlotDto: {
            area?: number | null;
            /** Format: uuid */
            farmId: string;
            location?: string | null;
            name: string;
            unit?: string | null;
        };
        PlotRecordDto: {
            /** @description Exact decimal serialized as a string */
            area: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            farmId: string;
            /** Format: uuid */
            id: string;
            location: string | null;
            name: string;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            unit: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        ProductBriefDto: {
            /** Format: uuid */
            id: string;
            productName: string;
        };
        ProductDto: {
            defaultUnit?: string | null;
            productName: string;
            variety?: string | null;
        };
        ProductionCycleRecordDto: {
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            currentState: "CREATED" | "PLANTED" | "GROWING" | "COMPLETED" | "CANCELLED";
            cycleCode: string;
            /** Format: uuid */
            farmId: string;
            /** Format: uuid */
            farmOrgId: string;
            harvestUnit: string | null;
            /** Format: uuid */
            id: string;
            /** @description Exact decimal serialized as a string */
            maxHarvestQuantity: string | null;
            note: string | null;
            /** Format: date-time */
            plannedHarvest: string | null;
            /** Format: uuid */
            plotId: string | null;
            /** Format: uuid */
            productId: string;
            /** Format: date-time */
            startDate: string | null;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        ProductOptionDto: {
            defaultUnit: string | null;
            /** Format: uuid */
            id: string;
            productName: string;
        };
        ProductRecordDto: {
            /** Format: date-time */
            createdAt: string;
            defaultUnit: string | null;
            description: string | null;
            /** Format: uuid */
            id: string;
            productName: string;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            /** Format: date-time */
            updatedAt: string;
            variety: string | null;
        };
        PublicCertificateDto: {
            documentHash: string;
            /** Format: date-time */
            expiryDate: string | null;
            /** Format: date-time */
            issueDate: string;
            issuer: string;
            /** @enum {string} */
            status: "APPROVED";
            type: string;
        };
        PublicLotDto: {
            allowedCommands: [
            ];
            availableQuantity: number;
            blockchainProof?: components["schemas"]["LotProofDto"];
            certificates: components["schemas"]["PublicCertificateDto"][];
            /** @enum {string} */
            currentState: "HARVESTED" | "IN_TRANSPORT" | "ARRIVED" | "RETAIL_RECEIVED" | "FOR_SALE" | "SOLD" | "RECALLED" | "EXPIRED" | "DAMAGED" | "REJECTED";
            /** Format: date */
            expiryDate: string | null;
            farmOrg: components["schemas"]["OrganizationSummaryDto"];
            /** Format: date-time */
            harvestTime: string;
            initialQuantity: number;
            isExpired: boolean;
            lotCode: string;
            /** Format: uuid */
            lotId: string;
            productionCycle: components["schemas"]["CycleSummaryDto"];
            productName: string;
            /** @enum {string} */
            proofStatus: "VERIFIED" | "PENDING" | "INTEGRITY_WARNING" | "BLOCKCHAIN_UNAVAILABLE";
            quantityReconciled: boolean;
            sensorEvidence: components["schemas"]["SensorEvidenceDto"];
            shipment: components["schemas"]["PublicShipmentDto"] | (never | null);
            stateReconciled: boolean;
            timeline: components["schemas"]["PublicTimelineDto"][];
            traceToken: string;
            unit: string;
            warnings: string[];
        };
        PublicShipmentDto: {
            /** Format: date-time */
            arrivalTime: string | null;
            destination: string;
            origin: string;
            /** Format: date-time */
            pickupTime: string | null;
            /** Format: date-time */
            receivedTime: string | null;
            /** @enum {string} */
            status: "CREATED" | "IN_TRANSIT" | "ARRIVED" | "DELIVERED" | "REJECTED" | "FAILED";
        };
        PublicTimelineActorDto: {
            organizationName: string;
            /** @enum {string} */
            role: "SYSTEM_ACTOR";
        };
        PublicTimelineDto: {
            actor: components["schemas"]["PublicTimelineActorDto"];
            /** @enum {string} */
            entityType: "PRODUCTION_CYCLE" | "CARE" | "SENSOR" | "SENSOR_DIGEST" | "HARVEST" | "LOT" | "SHIPMENT" | "SHIPMENT_TELEMETRY" | "INSPECTION" | "CERTIFICATE";
            /** Format: uuid */
            eventId: string;
            /** Format: date-time */
            eventTime: string;
            eventType: string;
            /** @enum {string} */
            proofStatus: "VERIFIED" | "PENDING" | "INTEGRITY_WARNING" | "BLOCKCHAIN_UNAVAILABLE";
            summary: string;
        };
        ReadingAcceptedDto: {
            late: boolean;
            /** Format: uuid */
            readingId: string;
            /** @enum {string} */
            status: "accepted";
        };
        ReceiveShipmentDto: {
            damagedQuantity?: number | null;
            lotVersion: number;
            note?: string | null;
            /** Format: date-time */
            occurredAt?: string | null;
            receivedQuantity: number;
            version: number;
        };
        ReconcileCycleSensorDto: {
            /** Format: date-time */
            plantedAt: string;
            reason: string;
            /** Format: uuid */
            throughHarvestId?: string | null;
            version: number;
        };
        ReconciliationResultDto: {
            cycleVersion: number;
            reconciliation: components["schemas"]["CycleSensorReconciliationRecordDto"];
        };
        RecordHarvestDto: {
            /**
             * @description YYYY-MM-DD or an ISO 8601 timestamp with timezone; normalized to the Vietnam calendar date. Projected responses use YYYY-MM-DD.
             * @example 2026-10-13
             */
            expiryDate?: string | null;
            /** Format: uuid */
            finalSensorDigestId?: string | null;
            grade?: string | null;
            harvestArea?: string | null;
            /** Format: date-time */
            harvestTime: string;
            lotCode?: string | null;
            qualityNote?: string | null;
            quantity: number;
            unit: string;
        };
        RegisterDto: {
            /** Format: email */
            email: string;
            fullName?: string | null;
            /** Format: password */
            password: string;
        };
        RejectShipmentDto: {
            lotVersion: number;
            /** Format: date-time */
            occurredAt?: string | null;
            reason: string;
            version: number;
        };
        ReviewCertificateDto: {
            reviewNote?: string | null;
            /** @enum {string} */
            status: "APPROVED" | "REJECTED";
            version: number;
        };
        RevocationDto: {
            /** @enum {boolean} */
            revoked: true;
        };
        RoleRecordDto: {
            code: string;
            description: string | null;
            /** Format: uuid */
            id: string;
            name: string;
        };
        SensorDigestRecordDto: {
            canonicalizationVersion: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            cycleId: string;
            digestHash: string;
            /** Format: uuid */
            id: string;
            isFinal: boolean;
            /** Format: date-time */
            periodEnd: string;
            /** Format: date-time */
            periodStart: string;
            readingCount: number;
            schemaVersion: string;
        };
        SensorEvidenceDto: {
            digestHash: string | null;
            /** Format: date-time */
            finalizedAt: string | null;
            lateReadingCount: number;
            /** Format: date-time */
            periodEnd: string | null;
            /** Format: date-time */
            periodStart: string | null;
            readingCount: number;
            /** @enum {string} */
            status: "FINALIZED" | "NO_DATA" | "LEGACY_UNVERIFIED" | "INTEGRITY_WARNING";
        };
        SensorReadingDto: {
            /** Format: uuid */
            deviceId: string;
            /** Format: date-time */
            recordedAt: string;
            sensorType: string;
            unit: string;
            value: number;
        };
        SensorReadingRecordDto: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            cycleId: string;
            /** Format: uuid */
            deviceId: string;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ingestTime: string;
            /** Format: date-time */
            recordedAt: string;
            sensorType: string;
            unit: string;
            /** @description Exact decimal serialized as a string */
            value: string;
        };
        SensorReadingResultDto: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            cycleId: string;
            /** Format: uuid */
            deviceId: string;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ingestTime: string;
            late: boolean;
            /** Format: date-time */
            recordedAt: string;
            sensorType: string;
            unit: string;
            /** @description Exact decimal serialized as a string */
            value: string;
        };
        ShipmentCountDto: {
            telemetry: number;
        };
        ShipmentDamageDto: {
            availableQuantity: number;
            /** @enum {string} */
            lotState: "IN_TRANSPORT" | "ARRIVED" | "DAMAGED";
            /** @enum {string} */
            shipmentStatus: "IN_TRANSIT" | "ARRIVED" | "FAILED";
        };
        ShipmentDetailDto: {
            /** Format: date-time */
            arrivalTime: string | null;
            conditions: ({
                [key: string]: unknown;
            } | null) | unknown[] | string | number | boolean;
            /** Format: date-time */
            createdAt: string;
            destination: string;
            /** Format: date-time */
            expectedArrival: string | null;
            /** Format: uuid */
            id: string;
            lot: components["schemas"]["DetailShipmentLotDto"];
            /** Format: uuid */
            lotId: string;
            origin: string;
            /** Format: date-time */
            pickupTime: string | null;
            /** Format: date-time */
            plannedPickupTime: string | null;
            /** @description Exact decimal serialized as a string */
            receivedQuantity: string | null;
            /** Format: date-time */
            receivedTime: string | null;
            /** @description Exact decimal serialized as a string */
            rejectedQuantity: string | null;
            rejectReason: string | null;
            retailer: components["schemas"]["OrganizationRecordDto"];
            /** Format: uuid */
            retailerOrgId: string;
            /** @description Exact decimal serialized as a string */
            shippedQuantity: string;
            /** @enum {string} */
            status: "CREATED" | "IN_TRANSIT" | "ARRIVED" | "DELIVERED" | "REJECTED" | "FAILED";
            telemetry: components["schemas"]["ShipmentTelemetryRecordDto"][];
            telemetryDigest: components["schemas"]["ShipmentTelemetryDigestRecordDto"] | (never | null);
            trackingBindings: components["schemas"]["TrackingBindingDto"][];
            transporter: components["schemas"]["OrganizationRecordDto"];
            /** Format: uuid */
            transporterOrgId: string;
            unit: string;
            /** Format: date-time */
            updatedAt: string;
            vehicleRef: string | null;
            version: number;
        };
        ShipmentListDto: {
            _count: components["schemas"]["ShipmentCountDto"];
            /** Format: date-time */
            arrivalTime: string | null;
            conditions: ({
                [key: string]: unknown;
            } | null) | unknown[] | string | number | boolean;
            /** Format: date-time */
            createdAt: string;
            destination: string;
            /** Format: date-time */
            expectedArrival: string | null;
            /** Format: uuid */
            id: string;
            lot: components["schemas"]["ListShipmentLotDto"];
            /** Format: uuid */
            lotId: string;
            origin: string;
            /** Format: date-time */
            pickupTime: string | null;
            /** Format: date-time */
            plannedPickupTime: string | null;
            /** @description Exact decimal serialized as a string */
            receivedQuantity: string | null;
            /** Format: date-time */
            receivedTime: string | null;
            /** @description Exact decimal serialized as a string */
            rejectedQuantity: string | null;
            rejectReason: string | null;
            retailer: components["schemas"]["OrgDto"];
            /** Format: uuid */
            retailerOrgId: string;
            /** @description Exact decimal serialized as a string */
            shippedQuantity: string;
            /** @enum {string} */
            status: "CREATED" | "IN_TRANSIT" | "ARRIVED" | "DELIVERED" | "REJECTED" | "FAILED";
            telemetryDigest: components["schemas"]["ShipmentTelemetryDigestRecordDto"] | (never | null);
            transporter: components["schemas"]["OrgDto"];
            /** Format: uuid */
            transporterOrgId: string;
            unit: string;
            /** Format: date-time */
            updatedAt: string;
            vehicleRef: string | null;
            version: number;
        };
        ShipmentRecordDto: {
            /** Format: date-time */
            arrivalTime: string | null;
            conditions: ({
                [key: string]: unknown;
            } | null) | unknown[] | string | number | boolean;
            /** Format: date-time */
            createdAt: string;
            destination: string;
            /** Format: date-time */
            expectedArrival: string | null;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            lotId: string;
            origin: string;
            /** Format: date-time */
            pickupTime: string | null;
            /** Format: date-time */
            plannedPickupTime: string | null;
            /** @description Exact decimal serialized as a string */
            receivedQuantity: string | null;
            /** Format: date-time */
            receivedTime: string | null;
            /** @description Exact decimal serialized as a string */
            rejectedQuantity: string | null;
            rejectReason: string | null;
            /** Format: uuid */
            retailerOrgId: string;
            /** @description Exact decimal serialized as a string */
            shippedQuantity: string;
            /** @enum {string} */
            status: "CREATED" | "IN_TRANSIT" | "ARRIVED" | "DELIVERED" | "REJECTED" | "FAILED";
            /** Format: uuid */
            transporterOrgId: string;
            unit: string;
            /** Format: date-time */
            updatedAt: string;
            vehicleRef: string | null;
            version: number;
        };
        ShipmentTelemetryDigestRecordDto: {
            anomalySummary: ({
                [key: string]: unknown;
            } | null) | unknown[] | string | number | boolean;
            canonicalizationVersion: string;
            conditionSummary: ({
                [key: string]: unknown;
            } | null) | unknown[] | string | number | boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            deviceId: string | null;
            digestHash: string;
            /** @description Exact decimal serialized as a string */
            firstLatitude: string | null;
            /** @description Exact decimal serialized as a string */
            firstLongitude: string | null;
            /** Format: uuid */
            id: string;
            isFinal: boolean;
            /** @description Exact decimal serialized as a string */
            lastLatitude: string | null;
            /** @description Exact decimal serialized as a string */
            lastLongitude: string | null;
            /** Format: date-time */
            periodEnd: string;
            /** Format: date-time */
            periodStart: string;
            previousDigestHash: string | null;
            readingCount: number;
            schemaVersion: string;
            /** Format: uuid */
            shipmentId: string;
        };
        ShipmentTelemetryRecordDto: {
            /** @description Exact decimal serialized as a string */
            accuracy: string | null;
            anomalyNote: string | null;
            /** @description Exact decimal serialized as a string */
            battery: string | null;
            /** Format: uuid */
            bindingId: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            deviceId: string;
            /** @description Integer serialized as a string to preserve precision */
            deviceSequence: string | null;
            /** @description Exact decimal serialized as a string */
            heading: string | null;
            /** @description Exact decimal serialized as a string */
            humidity: string | null;
            /** Format: uuid */
            id: string;
            idempotencyKey: string | null;
            /** Format: date-time */
            ingestTime: string;
            /** @description Exact decimal serialized as a string */
            latitude: string;
            /** @description Exact decimal serialized as a string */
            longitude: string;
            /** Format: date-time */
            recordedAt: string;
            /** Format: uuid */
            shipmentId: string;
            /** @description Exact decimal serialized as a string */
            speed: string | null;
            /** @description Exact decimal serialized as a string */
            temperature: string | null;
            validityStatus: string | null;
        };
        ShipmentTrackingBindingRecordDto: {
            /** Format: date-time */
            boundAt: string;
            /** Format: uuid */
            boundBy: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            deviceId: string;
            /** Format: uuid */
            id: string;
            note: string | null;
            /** Format: uuid */
            shipmentId: string;
            status: string;
            /** Format: uuid */
            transporterOrgId: string;
            /** Format: date-time */
            unboundAt: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        ShipmentTransitionDto: {
            lotVersion: number;
            /** Format: date-time */
            occurredAt?: string | null;
            version: number;
        };
        TelemetryAcceptedDto: {
            /** @enum {string} */
            status: "accepted";
            /** Format: uuid */
            telemetryId: string;
        };
        TraceHistoryDto: {
            actorAuthProof: string | null;
            /** Format: uuid */
            actorOrganizationId: string | null;
            actorRole: string;
            /** Format: uuid */
            actorUserId: string | null;
            authProofType: string | null;
            blockchainOutbox: components["schemas"]["BlockchainOutboxRecordDto"] | (never | null);
            blockchainProof: components["schemas"]["BlockchainProofRecordDto"] | (never | null);
            businessData: ({
                [key: string]: unknown;
            } | null) | unknown[] | string | number | boolean;
            canonicalizationVersion: string;
            /** Format: uuid */
            causationEventId: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            cycleId: string | null;
            dataHash: string;
            /** Format: uuid */
            entityId: string;
            entityType: string;
            /** Format: date-time */
            eventTime: string;
            eventType: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            lotId: string | null;
            previousEventHash: string | null;
            schemaVersion: string;
            /** Format: date-time */
            serverRecordedAt: string;
            /** Format: uuid */
            supersedesEventId: string | null;
        };
        TraceProofDto: {
            attemptCount: number;
            channelId: string;
            dataHash: string;
            /** Format: uuid */
            eventId: string;
            lastError: string | null;
            localHashMatches: boolean;
            network: string;
            /** Format: date-time */
            nextAttemptAt: string | null;
            /** @enum {string} */
            proofStatus: "VERIFIED" | "PENDING" | "INTEGRITY_WARNING" | "BLOCKCHAIN_UNAVAILABLE";
            /** Format: date-time */
            recordedAt: string | null;
            /** @enum {string} */
            transactionStatus: "PENDING" | "CONFIRMED" | "FAILED";
            txId: string | null;
        };
        TraceQrRecordDto: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            lotId: string;
            traceToken: string;
            traceUrl: string;
        };
        TrackingBindingDto: {
            /** Format: date-time */
            boundAt: string;
            /** Format: uuid */
            boundBy: string | null;
            /** Format: date-time */
            createdAt: string;
            device: components["schemas"]["IotDeviceRecordDto"];
            /** Format: uuid */
            deviceId: string;
            /** Format: uuid */
            id: string;
            note: string | null;
            /** Format: uuid */
            shipmentId: string;
            status: string;
            /** Format: uuid */
            transporterOrgId: string;
            /** Format: date-time */
            unboundAt: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        UnboundDto: {
            /** @enum {boolean} */
            unbound: true;
        };
        UpdateOrganizationDto: {
            name?: string | null;
            /** @enum {string|null} */
            status?: "ACTIVE" | "INACTIVE" | null;
        };
        UpdateUserStatusDto: {
            /** @enum {string} */
            accountStatus: "ACTIVE" | "INACTIVE" | "LOCKED";
        };
        UserCreatedDto: {
            /** @enum {string} */
            accountStatus: "ACTIVE" | "INACTIVE" | "LOCKED";
            /** Format: email */
            email: string;
            fullName: string;
            /** Format: uuid */
            id: string;
        };
        UserListDto: {
            /** @enum {string} */
            accountStatus: "ACTIVE" | "INACTIVE" | "LOCKED";
            /** Format: date-time */
            createdAt: string;
            /** Format: email */
            email: string;
            fullName: string;
            /** Format: uuid */
            id: string;
            organization: components["schemas"]["OrgDto"] | (never | null);
            role: components["schemas"]["UserRoleDto"];
            /** Format: date-time */
            updatedAt: string;
        };
        UserRoleDto: {
            code: string;
            name: string;
        };
        UserStatusDto: {
            /** @enum {string} */
            accountStatus: "ACTIVE" | "INACTIVE" | "LOCKED";
            /** Format: email */
            email: string;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            updatedAt: string;
        };
        VerifyProofDto: {
            attemptCount: number;
            channelId: string;
            dataHash: string;
            /** @enum {string} */
            deliveryStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "DEAD_LETTER";
            /** Format: uuid */
            eventId: string;
            lastError: string | null;
            localHashMatches: boolean;
            /** @enum {string} */
            proofStatus: "VERIFIED" | "PENDING" | "INTEGRITY_WARNING" | "BLOCKCHAIN_UNAVAILABLE";
            /** Format: date-time */
            recordedAt: string | null;
            /** @enum {string} */
            status: "PENDING" | "CONFIRMED" | "FAILED";
            txId: string | null;
        };
        VersionedCommandDto: {
            version: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    AppController_getHello: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: string;
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    AuthController_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthSessionResponseDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Invalid credentials or inactive user/organization */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Untrusted request origin */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    AuthController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthLogoutResponseDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Untrusted request origin */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    AuthController_getProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthProfileResponseDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Invalid JWT or inactive user, organization or session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    AuthController_refresh: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthSessionResponseDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Missing, expired, revoked or replayed session; JWTs without sid are rejected */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Untrusted request origin */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Concurrent rotation within 5 seconds; retry with the current cookie */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    AuthController_register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterDto"];
            };
        };
        responses: {
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Account registration is disabled; Admin provisions accounts. */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    BlockchainController_verify: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["VerifyProofDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    CatalogController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CatalogDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    CatalogController_farm: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FarmDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["FarmRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    CatalogController_plot: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlotDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PlotRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    CatalogController_product: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ProductRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ComplianceController_certificates: {
        parameters: {
            query: {
                cycleId: string;
                lotId: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CertificateRecordDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ComplianceController_createCertificate: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCertificateDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CertificateRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ComplianceController_reviewCertificate: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewCertificateDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CertificateRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Cần assignment active với Farm; reviewer không được tự duyệt hoặc ghi lại quyết định. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ComplianceAssignmentsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["AssignmentListDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ComplianceAssignmentsController_grant: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GrantAssignmentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ComplianceAssignmentRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ComplianceAssignmentsController_revoke: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssignmentReasonDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ComplianceAssignmentRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    LotsController_dashboard: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["DashboardDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    HealthController_check: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["HealthDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    HealthController_live: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["HealthDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ComplianceController_inspections: {
        parameters: {
            query: {
                lotId: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["InspectionListDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ComplianceController_createInspection: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateInspectionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["InspectionRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Chỉ COMPLIANCE_REVIEWER có assignment active với Farm của Lot được ghi inspection. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_createSensorDigest: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path: {
                cycleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSensorDigestDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["SensorDigestRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_ingestForDevice: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
                "X-Device-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IngestSensorReadingDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ReadingAcceptedDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_devices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["DeviceListDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_createDevice: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateIotDeviceDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["IotDeviceRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_ingestForUser: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IngestSensorReadingDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ReadingAcceptedDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_ingestTelemetryForDevice: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
                "X-Device-Key": string;
            };
            path: {
                shipmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IngestShipmentTelemetryDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TelemetryAcceptedDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_bindShipmentDevice: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path: {
                shipmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BindShipmentDeviceDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentTrackingBindingRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_unbindShipmentDevice: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path: {
                deviceId: string;
                shipmentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["UnboundDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_ingestTelemetryForUser: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path: {
                shipmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IngestShipmentTelemetryDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TelemetryAcceptedDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    IotController_createTelemetryDigest: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path: {
                shipmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTelemetryDigestDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentTelemetryDigestRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    LotsController_getLots: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["InternalLotDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    LotsController_getLot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                lotId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["InternalLotDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    LotCommandsController_damage: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                lotId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DamageLotDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["LotCommandResultDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    LotCommandsController_expire: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                lotId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LotReasonCommandDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["LotCommandResultDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    LotCommandsController_markForSale: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                lotId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LotVersionCommandDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["LotCommandResultDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    LotCommandsController_markSold: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                lotId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LotVersionCommandDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["LotCommandResultDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    LotCommandsController_recall: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                lotId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LotReasonCommandDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["LotCommandResultDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    OrganizationsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["OrganizationRecordDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    OrganizationsController_create: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOrganizationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["OrganizationRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    OrganizationsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateOrganizationDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["OrganizationRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ProductionCyclesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CycleListDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ProductionCyclesController_create: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProductionCycleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ProductionCycleRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    LotsController_harvest: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "idempotency-key": string;
            };
            path: {
                cycleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecordHarvestDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["HarvestResultDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ProductionCyclesController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CycleDetailDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ProductionCyclesController_cancel: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CancelCycleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ProductionCycleRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ProductionCyclesController_care: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CareRecordDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CareResultDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ProductionCyclesController_close: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VersionedCommandDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ProductionCycleRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ProductionCyclesController_plant: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlantCycleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ProductionCycleRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ProductionCyclesController_sensor: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SensorReadingDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["SensorReadingResultDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ProductionCyclesController_reconcileSensor: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReconcileCycleSensorDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ReconciliationResultDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    PublicTraceController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PublicLotDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ShipmentsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentListDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ShipmentsController_create: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateShipmentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ShipmentsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentDetailDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ShipmentsController_arrive: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShipmentTransitionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ShipmentsController_damage: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DamageShipmentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentDamageDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ShipmentsController_receive: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReceiveShipmentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ShipmentsController_reject: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RejectShipmentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    ShipmentsController_start: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShipmentTransitionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ShipmentRecordDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    TraceController_getProof: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TraceProofDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    TraceController_getLotHistory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                lotId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["TraceHistoryDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    UsersController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["UserListDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    UsersController_create: {
        parameters: {
            query?: never;
            header: {
                /** @description Required command key: trimmed, nonblank, at most 255 characters after trimming. Replays the stored result for the same requester/operation/payload after authorization. Missing/invalid key, changed payload or an in-progress command returns 409. This header is not an authentication credential. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateUserDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["UserCreatedDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    UsersController_updateStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateUserStatusDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["UserStatusDto"];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
    UsersController_roles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["RoleRecordDto"][];
                        requestId: string;
                        /** @enum {boolean} */
                        success: true;
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
            /** @description Error envelope from GlobalExceptionFilter */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiErrorEnvelopeDto"];
                };
            };
        };
    };
}
