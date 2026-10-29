import * as $protobuf from "protobufjs";
import Long = require("long");

export namespace sma {

    namespace v1 {

        interface ISignedBlob extends sma.v1.SignedBlob.$Properties {
        }

        class SignedBlob {
            constructor(p?: sma.v1.SignedBlob.$Properties);
            $unknowns?: Uint8Array[];
            body: Uint8Array;
            signer: Uint8Array;
            signature: Uint8Array;
            static create(properties: sma.v1.SignedBlob.$Shape): sma.v1.SignedBlob & sma.v1.SignedBlob.$Shape;
            static create(properties?: sma.v1.SignedBlob.$Properties): sma.v1.SignedBlob;
            static encode(m: sma.v1.SignedBlob.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.SignedBlob & sma.v1.SignedBlob.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.SignedBlob;
            static toObject(m: sma.v1.SignedBlob, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace SignedBlob {
            interface $Properties {
                body?: (Uint8Array|null);
                signer?: (Uint8Array|null);
                signature?: (Uint8Array|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.SignedBlob.$Properties;
        }

        interface IPrekeyBundle extends sma.v1.PrekeyBundle.$Properties {
        }

        class PrekeyBundle {
            constructor(p?: sma.v1.PrekeyBundle.$Properties);
            $unknowns?: Uint8Array[];
            version: number;
            identityKey: Uint8Array;
            identityKemKey: Uint8Array;
            signedPrekey?: (sma.v1.SignedPrekey.$Properties|null);
            devices: sma.v1.SignedBlob.$Properties[];
            publishedAtMs: (number|Long);
            static create(properties: sma.v1.PrekeyBundle.$Shape): sma.v1.PrekeyBundle & sma.v1.PrekeyBundle.$Shape;
            static create(properties?: sma.v1.PrekeyBundle.$Properties): sma.v1.PrekeyBundle;
            static encode(m: sma.v1.PrekeyBundle.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.PrekeyBundle & sma.v1.PrekeyBundle.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.PrekeyBundle;
            static toObject(m: sma.v1.PrekeyBundle, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace PrekeyBundle {
            interface $Properties {
                version?: (number|null);
                identityKey?: (Uint8Array|null);
                identityKemKey?: (Uint8Array|null);
                signedPrekey?: (sma.v1.SignedPrekey.$Properties|null);
                devices?: (sma.v1.SignedBlob.$Properties[]|null);
                publishedAtMs?: (number|Long|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.PrekeyBundle.$Properties;
        }

        interface ISignedPrekey extends sma.v1.SignedPrekey.$Properties {
        }

        class SignedPrekey {
            constructor(p?: sma.v1.SignedPrekey.$Properties);
            $unknowns?: Uint8Array[];
            id: number;
            publicKey: Uint8Array;
            createdAtMs: (number|Long);
            expiresAtMs: (number|Long);
            static create(properties: sma.v1.SignedPrekey.$Shape): sma.v1.SignedPrekey & sma.v1.SignedPrekey.$Shape;
            static create(properties?: sma.v1.SignedPrekey.$Properties): sma.v1.SignedPrekey;
            static encode(m: sma.v1.SignedPrekey.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.SignedPrekey & sma.v1.SignedPrekey.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.SignedPrekey;
            static toObject(m: sma.v1.SignedPrekey, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace SignedPrekey {
            interface $Properties {
                id?: (number|null);
                publicKey?: (Uint8Array|null);
                createdAtMs?: (number|Long|null);
                expiresAtMs?: (number|Long|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.SignedPrekey.$Properties;
        }

        interface IOneTimePrekey extends sma.v1.OneTimePrekey.$Properties {
        }

        class OneTimePrekey {
            constructor(p?: sma.v1.OneTimePrekey.$Properties);
            $unknowns?: Uint8Array[];
            id: number;
            publicKey: Uint8Array;
            expiresAtMs: (number|Long);
            static create(properties: sma.v1.OneTimePrekey.$Shape): sma.v1.OneTimePrekey & sma.v1.OneTimePrekey.$Shape;
            static create(properties?: sma.v1.OneTimePrekey.$Properties): sma.v1.OneTimePrekey;
            static encode(m: sma.v1.OneTimePrekey.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.OneTimePrekey & sma.v1.OneTimePrekey.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.OneTimePrekey;
            static toObject(m: sma.v1.OneTimePrekey, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace OneTimePrekey {
            interface $Properties {
                id?: (number|null);
                publicKey?: (Uint8Array|null);
                expiresAtMs?: (number|Long|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.OneTimePrekey.$Properties;
        }

        interface IDeviceCertificate extends sma.v1.DeviceCertificate.$Properties {
        }

        class DeviceCertificate {
            constructor(p?: sma.v1.DeviceCertificate.$Properties);
            $unknowns?: Uint8Array[];
            deviceId: Uint8Array;
            deviceSigningKey: Uint8Array;
            deviceKemKey: Uint8Array;
            issuedAtMs: (number|Long);
            expiresAtMs: (number|Long);
            label: string;
            capabilities: number;
            static create(properties: sma.v1.DeviceCertificate.$Shape): sma.v1.DeviceCertificate & sma.v1.DeviceCertificate.$Shape;
            static create(properties?: sma.v1.DeviceCertificate.$Properties): sma.v1.DeviceCertificate;
            static encode(m: sma.v1.DeviceCertificate.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.DeviceCertificate & sma.v1.DeviceCertificate.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.DeviceCertificate;
            static toObject(m: sma.v1.DeviceCertificate, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace DeviceCertificate {
            interface $Properties {
                deviceId?: (Uint8Array|null);
                deviceSigningKey?: (Uint8Array|null);
                deviceKemKey?: (Uint8Array|null);
                issuedAtMs?: (number|Long|null);
                expiresAtMs?: (number|Long|null);
                label?: (string|null);
                capabilities?: (number|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.DeviceCertificate.$Properties;
        }

        interface IContactCapsule extends sma.v1.ContactCapsule.$Properties {
        }

        class ContactCapsule {
            constructor(p?: sma.v1.ContactCapsule.$Properties);
            $unknowns?: Uint8Array[];
            version: number;
            fingerprint: Uint8Array;
            capsuleKey: Uint8Array;
            cardLocators: sma.v1.Locator.$Properties[];
            expiresAtMs: (number|Long);
            static create(properties: sma.v1.ContactCapsule.$Shape): sma.v1.ContactCapsule & sma.v1.ContactCapsule.$Shape;
            static create(properties?: sma.v1.ContactCapsule.$Properties): sma.v1.ContactCapsule;
            static encode(m: sma.v1.ContactCapsule.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.ContactCapsule & sma.v1.ContactCapsule.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.ContactCapsule;
            static toObject(m: sma.v1.ContactCapsule, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace ContactCapsule {
            interface $Properties {
                version?: (number|null);
                fingerprint?: (Uint8Array|null);
                capsuleKey?: (Uint8Array|null);
                cardLocators?: (sma.v1.Locator.$Properties[]|null);
                expiresAtMs?: (number|Long|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              version?: number|null;
              fingerprint?: Uint8Array|null;
              capsuleKey?: Uint8Array|null;
              cardLocators?: sma.v1.Locator.$Shape[]|null;
              expiresAtMs?: number|Long|null;
              $unknowns?: Uint8Array[];
            };
        }

        interface IContactCard extends sma.v1.ContactCard.$Properties {
        }

        class ContactCard {
            constructor(p?: sma.v1.ContactCard.$Properties);
            $unknowns?: Uint8Array[];
            bundle?: (sma.v1.SignedBlob.$Properties|null);
            inboxTagKey: Uint8Array;
            inboxes: sma.v1.MailboxAddress.$Properties[];
            oneTimePrekey?: (sma.v1.SignedBlob.$Properties|null);
            displayName: string;
            avatarSha256: Uint8Array;
            avatarLocators: sma.v1.Locator.$Properties[];
            static create(properties: sma.v1.ContactCard.$Shape): sma.v1.ContactCard & sma.v1.ContactCard.$Shape;
            static create(properties?: sma.v1.ContactCard.$Properties): sma.v1.ContactCard;
            static encode(m: sma.v1.ContactCard.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.ContactCard & sma.v1.ContactCard.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.ContactCard;
            static toObject(m: sma.v1.ContactCard, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace ContactCard {
            interface $Properties {
                bundle?: (sma.v1.SignedBlob.$Properties|null);
                inboxTagKey?: (Uint8Array|null);
                inboxes?: (sma.v1.MailboxAddress.$Properties[]|null);
                oneTimePrekey?: (sma.v1.SignedBlob.$Properties|null);
                displayName?: (string|null);
                avatarSha256?: (Uint8Array|null);
                avatarLocators?: (sma.v1.Locator.$Properties[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              bundle?: sma.v1.SignedBlob.$Shape|null;
              inboxTagKey?: Uint8Array|null;
              inboxes?: sma.v1.MailboxAddress.$Shape[]|null;
              oneTimePrekey?: sma.v1.SignedBlob.$Shape|null;
              displayName?: string|null;
              avatarSha256?: Uint8Array|null;
              avatarLocators?: sma.v1.Locator.$Shape[]|null;
              $unknowns?: Uint8Array[];
            };
        }

        interface IMailboxAddress extends sma.v1.MailboxAddress.$Properties {
        }

        class MailboxAddress {
            constructor(p?: sma.v1.MailboxAddress.$Properties);
            $unknowns?: Uint8Array[];
            nostr?: (sma.v1.NostrMailbox.$Properties|null);
            telegram?: (sma.v1.TelegramMailbox.$Properties|null);
            matrix?: (sma.v1.MatrixMailbox.$Properties|null);
            kind?: ("nostr"|"telegram"|"matrix");
            static create(properties: sma.v1.MailboxAddress.$Shape): sma.v1.MailboxAddress & sma.v1.MailboxAddress.$Shape;
            static create(properties?: sma.v1.MailboxAddress.$Properties): sma.v1.MailboxAddress;
            static encode(m: sma.v1.MailboxAddress.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.MailboxAddress & sma.v1.MailboxAddress.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.MailboxAddress;
            static toObject(m: sma.v1.MailboxAddress, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace MailboxAddress {
            interface $Properties {
                nostr?: (sma.v1.NostrMailbox.$Properties|null);
                telegram?: (sma.v1.TelegramMailbox.$Properties|null);
                matrix?: (sma.v1.MatrixMailbox.$Properties|null);
                kind?: ("nostr"|"telegram"|"matrix");
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              nostr?: sma.v1.NostrMailbox.$Shape|null;
              telegram?: sma.v1.TelegramMailbox.$Shape|null;
              matrix?: sma.v1.MatrixMailbox.$Shape|null;
              $unknowns?: Uint8Array[];
            } & (
              ({ kind?: undefined; nostr?: null; telegram?: null; matrix?: null }|{ kind?: "nostr"; nostr: sma.v1.NostrMailbox.$Shape; telegram?: null; matrix?: null }|{ kind?: "telegram"; nostr?: null; telegram: sma.v1.TelegramMailbox.$Shape; matrix?: null }|{ kind?: "matrix"; nostr?: null; telegram?: null; matrix: sma.v1.MatrixMailbox.$Shape })
            );
        }

        interface INostrMailbox extends sma.v1.NostrMailbox.$Properties {
        }

        class NostrMailbox {
            constructor(p?: sma.v1.NostrMailbox.$Properties);
            $unknowns?: Uint8Array[];
            relays: string[];
            static create(properties: sma.v1.NostrMailbox.$Shape): sma.v1.NostrMailbox & sma.v1.NostrMailbox.$Shape;
            static create(properties?: sma.v1.NostrMailbox.$Properties): sma.v1.NostrMailbox;
            static encode(m: sma.v1.NostrMailbox.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.NostrMailbox & sma.v1.NostrMailbox.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.NostrMailbox;
            static toObject(m: sma.v1.NostrMailbox, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace NostrMailbox {
            interface $Properties {
                relays?: (string[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.NostrMailbox.$Properties;
        }

        interface ITelegramMailbox extends sma.v1.TelegramMailbox.$Properties {
        }

        class TelegramMailbox {
            constructor(p?: sma.v1.TelegramMailbox.$Properties);
            $unknowns?: Uint8Array[];
            chatId: (number|Long);
            inviteLink: string;
            static create(properties: sma.v1.TelegramMailbox.$Shape): sma.v1.TelegramMailbox & sma.v1.TelegramMailbox.$Shape;
            static create(properties?: sma.v1.TelegramMailbox.$Properties): sma.v1.TelegramMailbox;
            static encode(m: sma.v1.TelegramMailbox.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.TelegramMailbox & sma.v1.TelegramMailbox.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.TelegramMailbox;
            static toObject(m: sma.v1.TelegramMailbox, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace TelegramMailbox {
            interface $Properties {
                chatId?: (number|Long|null);
                inviteLink?: (string|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.TelegramMailbox.$Properties;
        }

        interface IMatrixMailbox extends sma.v1.MatrixMailbox.$Properties {
        }

        class MatrixMailbox {
            constructor(p?: sma.v1.MatrixMailbox.$Properties);
            $unknowns?: Uint8Array[];
            roomId: string;
            homeserver: string;
            static create(properties: sma.v1.MatrixMailbox.$Shape): sma.v1.MatrixMailbox & sma.v1.MatrixMailbox.$Shape;
            static create(properties?: sma.v1.MatrixMailbox.$Properties): sma.v1.MatrixMailbox;
            static encode(m: sma.v1.MatrixMailbox.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.MatrixMailbox & sma.v1.MatrixMailbox.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.MatrixMailbox;
            static toObject(m: sma.v1.MatrixMailbox, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace MatrixMailbox {
            interface $Properties {
                roomId?: (string|null);
                homeserver?: (string|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.MatrixMailbox.$Properties;
        }

        interface ILocator extends sma.v1.Locator.$Properties {
        }

        class Locator {
            constructor(p?: sma.v1.Locator.$Properties);
            $unknowns?: Uint8Array[];
            telegram?: (string|null);
            ipfsCid?: (string|null);
            blossom?: (string|null);
            https?: (string|null);
            webrtcPeer?: (Uint8Array|null);
            nostr?: (sma.v1.NostrLocator.$Properties|null);
            where?: ("telegram"|"ipfsCid"|"blossom"|"https"|"webrtcPeer"|"nostr");
            static create(properties: sma.v1.Locator.$Shape): sma.v1.Locator & sma.v1.Locator.$Shape;
            static create(properties?: sma.v1.Locator.$Properties): sma.v1.Locator;
            static encode(m: sma.v1.Locator.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.Locator & sma.v1.Locator.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.Locator;
            static toObject(m: sma.v1.Locator, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace Locator {
            interface $Properties {
                telegram?: (string|null);
                ipfsCid?: (string|null);
                blossom?: (string|null);
                https?: (string|null);
                webrtcPeer?: (Uint8Array|null);
                nostr?: (sma.v1.NostrLocator.$Properties|null);
                where?: ("telegram"|"ipfsCid"|"blossom"|"https"|"webrtcPeer"|"nostr");
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              telegram?: string|null;
              ipfsCid?: string|null;
              blossom?: string|null;
              https?: string|null;
              webrtcPeer?: Uint8Array|null;
              nostr?: sma.v1.NostrLocator.$Shape|null;
              $unknowns?: Uint8Array[];
            } & (
              ({ where?: undefined; telegram?: null; ipfsCid?: null; blossom?: null; https?: null; webrtcPeer?: null; nostr?: null }|{ where?: "telegram"; telegram: string; ipfsCid?: null; blossom?: null; https?: null; webrtcPeer?: null; nostr?: null }|{ where?: "ipfsCid"; telegram?: null; ipfsCid: string; blossom?: null; https?: null; webrtcPeer?: null; nostr?: null }|{ where?: "blossom"; telegram?: null; ipfsCid?: null; blossom: string; https?: null; webrtcPeer?: null; nostr?: null }|{ where?: "https"; telegram?: null; ipfsCid?: null; blossom?: null; https: string; webrtcPeer?: null; nostr?: null }|{ where?: "webrtcPeer"; telegram?: null; ipfsCid?: null; blossom?: null; https?: null; webrtcPeer: Uint8Array; nostr?: null }|{ where?: "nostr"; telegram?: null; ipfsCid?: null; blossom?: null; https?: null; webrtcPeer?: null; nostr: sma.v1.NostrLocator.$Shape })
            );
        }

        interface INostrLocator extends sma.v1.NostrLocator.$Properties {
        }

        class NostrLocator {
            constructor(p?: sma.v1.NostrLocator.$Properties);
            $unknowns?: Uint8Array[];
            relays: string[];
            tag: Uint8Array;
            static create(properties: sma.v1.NostrLocator.$Shape): sma.v1.NostrLocator & sma.v1.NostrLocator.$Shape;
            static create(properties?: sma.v1.NostrLocator.$Properties): sma.v1.NostrLocator;
            static encode(m: sma.v1.NostrLocator.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.NostrLocator & sma.v1.NostrLocator.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.NostrLocator;
            static toObject(m: sma.v1.NostrLocator, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace NostrLocator {
            interface $Properties {
                relays?: (string[]|null);
                tag?: (Uint8Array|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.NostrLocator.$Properties;
        }

        interface IContent extends sma.v1.Content.$Properties {
        }

        class Content {
            constructor(p?: sma.v1.Content.$Properties);
            $unknowns?: Uint8Array[];
            messageId: Uint8Array;
            sentAtMs: (number|Long);
            expireAfterS: number;
            replyTo: Uint8Array;
            groupId: Uint8Array;
            text?: (sma.v1.Text.$Properties|null);
            file?: (sma.v1.FileManifest.$Properties|null);
            call?: (sma.v1.CallSignal.$Properties|null);
            groupKey?: (sma.v1.GroupKeyDistribution.$Properties|null);
            receipt?: (sma.v1.Receipt.$Properties|null);
            reaction?: (sma.v1.Reaction.$Properties|null);
            edit?: (sma.v1.Edit.$Properties|null);
            delete?: (sma.v1.Delete.$Properties|null);
            typing?: (sma.v1.Typing.$Properties|null);
            groupControl?: (sma.v1.GroupControl.$Properties|null);
            deviceSync?: (sma.v1.DeviceSync.$Properties|null);
            prekeyRefresh?: (sma.v1.PrekeyRefresh.$Properties|null);
            plugin?: (sma.v1.PluginMessage.$Properties|null);
            contactCard?: (sma.v1.ContactCard.$Properties|null);
            body?: ("text"|"file"|"call"|"groupKey"|"receipt"|"reaction"|"edit"|"delete"|"typing"|"groupControl"|"deviceSync"|"prekeyRefresh"|"plugin"|"contactCard");
            static create(properties: sma.v1.Content.$Shape): sma.v1.Content & sma.v1.Content.$Shape;
            static create(properties?: sma.v1.Content.$Properties): sma.v1.Content;
            static encode(m: sma.v1.Content.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.Content & sma.v1.Content.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.Content;
            static toObject(m: sma.v1.Content, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace Content {
            interface $Properties {
                messageId?: (Uint8Array|null);
                sentAtMs?: (number|Long|null);
                expireAfterS?: (number|null);
                replyTo?: (Uint8Array|null);
                groupId?: (Uint8Array|null);
                text?: (sma.v1.Text.$Properties|null);
                file?: (sma.v1.FileManifest.$Properties|null);
                call?: (sma.v1.CallSignal.$Properties|null);
                groupKey?: (sma.v1.GroupKeyDistribution.$Properties|null);
                receipt?: (sma.v1.Receipt.$Properties|null);
                reaction?: (sma.v1.Reaction.$Properties|null);
                edit?: (sma.v1.Edit.$Properties|null);
                "delete"?: (sma.v1.Delete.$Properties|null);
                typing?: (sma.v1.Typing.$Properties|null);
                groupControl?: (sma.v1.GroupControl.$Properties|null);
                deviceSync?: (sma.v1.DeviceSync.$Properties|null);
                prekeyRefresh?: (sma.v1.PrekeyRefresh.$Properties|null);
                plugin?: (sma.v1.PluginMessage.$Properties|null);
                contactCard?: (sma.v1.ContactCard.$Properties|null);
                body?: ("text"|"file"|"call"|"groupKey"|"receipt"|"reaction"|"edit"|"delete"|"typing"|"groupControl"|"deviceSync"|"prekeyRefresh"|"plugin"|"contactCard");
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              messageId?: Uint8Array|null;
              sentAtMs?: number|Long|null;
              expireAfterS?: number|null;
              replyTo?: Uint8Array|null;
              groupId?: Uint8Array|null;
              text?: sma.v1.Text.$Shape|null;
              file?: sma.v1.FileManifest.$Shape|null;
              call?: sma.v1.CallSignal.$Shape|null;
              groupKey?: sma.v1.GroupKeyDistribution.$Shape|null;
              receipt?: sma.v1.Receipt.$Shape|null;
              reaction?: sma.v1.Reaction.$Shape|null;
              edit?: sma.v1.Edit.$Shape|null;
              "delete"?: sma.v1.Delete.$Shape|null;
              typing?: sma.v1.Typing.$Shape|null;
              groupControl?: sma.v1.GroupControl.$Shape|null;
              deviceSync?: sma.v1.DeviceSync.$Shape|null;
              prekeyRefresh?: sma.v1.PrekeyRefresh.$Shape|null;
              plugin?: sma.v1.PluginMessage.$Shape|null;
              contactCard?: sma.v1.ContactCard.$Shape|null;
              $unknowns?: Uint8Array[];
            } & (
              ({ body?: undefined; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "text"; text: sma.v1.Text.$Shape; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "file"; text?: null; file: sma.v1.FileManifest.$Shape; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "call"; text?: null; file?: null; call: sma.v1.CallSignal.$Shape; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "groupKey"; text?: null; file?: null; call?: null; groupKey: sma.v1.GroupKeyDistribution.$Shape; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "receipt"; text?: null; file?: null; call?: null; groupKey?: null; receipt: sma.v1.Receipt.$Shape; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "reaction"; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction: sma.v1.Reaction.$Shape; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "edit"; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit: sma.v1.Edit.$Shape; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "delete"; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete": sma.v1.Delete.$Shape; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "typing"; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing: sma.v1.Typing.$Shape; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "groupControl"; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl: sma.v1.GroupControl.$Shape; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "deviceSync"; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync: sma.v1.DeviceSync.$Shape; prekeyRefresh?: null; plugin?: null; contactCard?: null }|{ body?: "prekeyRefresh"; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh: sma.v1.PrekeyRefresh.$Shape; plugin?: null; contactCard?: null }|{ body?: "plugin"; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin: sma.v1.PluginMessage.$Shape; contactCard?: null }|{ body?: "contactCard"; text?: null; file?: null; call?: null; groupKey?: null; receipt?: null; reaction?: null; edit?: null; "delete"?: null; typing?: null; groupControl?: null; deviceSync?: null; prekeyRefresh?: null; plugin?: null; contactCard: sma.v1.ContactCard.$Shape })
            );
        }

        interface IText extends sma.v1.Text.$Properties {
        }

        class Text {
            constructor(p?: sma.v1.Text.$Properties);
            $unknowns?: Uint8Array[];
            body: string;
            mentions: sma.v1.Mention.$Properties[];
            static create(properties: sma.v1.Text.$Shape): sma.v1.Text & sma.v1.Text.$Shape;
            static create(properties?: sma.v1.Text.$Properties): sma.v1.Text;
            static encode(m: sma.v1.Text.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.Text & sma.v1.Text.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.Text;
            static toObject(m: sma.v1.Text, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace Text {
            interface $Properties {
                body?: (string|null);
                mentions?: (sma.v1.Mention.$Properties[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.Text.$Properties;
        }

        interface IMention extends sma.v1.Mention.$Properties {
        }

        class Mention {
            constructor(p?: sma.v1.Mention.$Properties);
            $unknowns?: Uint8Array[];
            start: number;
            length: number;
            fingerprint: Uint8Array;
            static create(properties: sma.v1.Mention.$Shape): sma.v1.Mention & sma.v1.Mention.$Shape;
            static create(properties?: sma.v1.Mention.$Properties): sma.v1.Mention;
            static encode(m: sma.v1.Mention.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.Mention & sma.v1.Mention.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.Mention;
            static toObject(m: sma.v1.Mention, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace Mention {
            interface $Properties {
                start?: (number|null);
                length?: (number|null);
                fingerprint?: (Uint8Array|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.Mention.$Properties;
        }

        interface IFileManifest extends sma.v1.FileManifest.$Properties {
        }

        class FileManifest {
            constructor(p?: sma.v1.FileManifest.$Properties);
            $unknowns?: Uint8Array[];
            mimeType: string;
            fileName: string;
            size: (number|Long);
            fileKey: Uint8Array;
            noncePrefix: Uint8Array;
            chunkSize: number;
            chunks: sma.v1.BlobRef.$Properties[];
            plaintextSha256: Uint8Array;
            thumbnail: Uint8Array;
            width: number;
            height: number;
            durationMs: number;
            static create(properties: sma.v1.FileManifest.$Shape): sma.v1.FileManifest & sma.v1.FileManifest.$Shape;
            static create(properties?: sma.v1.FileManifest.$Properties): sma.v1.FileManifest;
            static encode(m: sma.v1.FileManifest.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.FileManifest & sma.v1.FileManifest.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.FileManifest;
            static toObject(m: sma.v1.FileManifest, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace FileManifest {
            interface $Properties {
                mimeType?: (string|null);
                fileName?: (string|null);
                size?: (number|Long|null);
                fileKey?: (Uint8Array|null);
                noncePrefix?: (Uint8Array|null);
                chunkSize?: (number|null);
                chunks?: (sma.v1.BlobRef.$Properties[]|null);
                plaintextSha256?: (Uint8Array|null);
                thumbnail?: (Uint8Array|null);
                width?: (number|null);
                height?: (number|null);
                durationMs?: (number|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              mimeType?: string|null;
              fileName?: string|null;
              size?: number|Long|null;
              fileKey?: Uint8Array|null;
              noncePrefix?: Uint8Array|null;
              chunkSize?: number|null;
              chunks?: sma.v1.BlobRef.$Shape[]|null;
              plaintextSha256?: Uint8Array|null;
              thumbnail?: Uint8Array|null;
              width?: number|null;
              height?: number|null;
              durationMs?: number|null;
              $unknowns?: Uint8Array[];
            };
        }

        interface IBlobRef extends sma.v1.BlobRef.$Properties {
        }

        class BlobRef {
            constructor(p?: sma.v1.BlobRef.$Properties);
            $unknowns?: Uint8Array[];
            ciphertextSha256: Uint8Array;
            locators: sma.v1.Locator.$Properties[];
            static create(properties: sma.v1.BlobRef.$Shape): sma.v1.BlobRef & sma.v1.BlobRef.$Shape;
            static create(properties?: sma.v1.BlobRef.$Properties): sma.v1.BlobRef;
            static encode(m: sma.v1.BlobRef.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.BlobRef & sma.v1.BlobRef.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.BlobRef;
            static toObject(m: sma.v1.BlobRef, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace BlobRef {
            interface $Properties {
                ciphertextSha256?: (Uint8Array|null);
                locators?: (sma.v1.Locator.$Properties[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              ciphertextSha256?: Uint8Array|null;
              locators?: sma.v1.Locator.$Shape[]|null;
              $unknowns?: Uint8Array[];
            };
        }

        interface ICallSignal extends sma.v1.CallSignal.$Properties {
        }

        class CallSignal {
            constructor(p?: sma.v1.CallSignal.$Properties);
            $unknowns?: Uint8Array[];
            callId: Uint8Array;
            type: sma.v1.CallSignal.Type;
            sdp: string;
            candidates: sma.v1.IceCandidate.$Properties[];
            mediaKeySeed: Uint8Array;
            keyEpoch: number;
            video: boolean;
            expiresAtMs: (number|Long);
            reason: string;
            static create(properties: sma.v1.CallSignal.$Shape): sma.v1.CallSignal & sma.v1.CallSignal.$Shape;
            static create(properties?: sma.v1.CallSignal.$Properties): sma.v1.CallSignal;
            static encode(m: sma.v1.CallSignal.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.CallSignal & sma.v1.CallSignal.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.CallSignal;
            static toObject(m: sma.v1.CallSignal, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace CallSignal {
            interface $Properties {
                callId?: (Uint8Array|null);
                type?: (sma.v1.CallSignal.Type|null);
                sdp?: (string|null);
                candidates?: (sma.v1.IceCandidate.$Properties[]|null);
                mediaKeySeed?: (Uint8Array|null);
                keyEpoch?: (number|null);
                video?: (boolean|null);
                expiresAtMs?: (number|Long|null);
                reason?: (string|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.CallSignal.$Properties;

            enum Type {
                TYPE_UNSPECIFIED = 0,
                OFFER = 1,
                ANSWER = 2,
                ICE_CANDIDATES = 3,
                RINGING = 4,
                HANGUP = 5,
                REJECT = 6,
                BUSY = 7,
                RENEGOTIATE = 8,
                MEDIA_KEY_UPDATE = 9
            }
        }

        interface IIceCandidate extends sma.v1.IceCandidate.$Properties {
        }

        class IceCandidate {
            constructor(p?: sma.v1.IceCandidate.$Properties);
            $unknowns?: Uint8Array[];
            candidate: string;
            sdpMid: string;
            sdpMLineIndex: number;
            usernameFragment: string;
            static create(properties: sma.v1.IceCandidate.$Shape): sma.v1.IceCandidate & sma.v1.IceCandidate.$Shape;
            static create(properties?: sma.v1.IceCandidate.$Properties): sma.v1.IceCandidate;
            static encode(m: sma.v1.IceCandidate.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.IceCandidate & sma.v1.IceCandidate.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.IceCandidate;
            static toObject(m: sma.v1.IceCandidate, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace IceCandidate {
            interface $Properties {
                candidate?: (string|null);
                sdpMid?: (string|null);
                sdpMLineIndex?: (number|null);
                usernameFragment?: (string|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.IceCandidate.$Properties;
        }

        interface IGroupKeyDistribution extends sma.v1.GroupKeyDistribution.$Properties {
        }

        class GroupKeyDistribution {
            constructor(p?: sma.v1.GroupKeyDistribution.$Properties);
            $unknowns?: Uint8Array[];
            groupId: Uint8Array;
            epoch: number;
            keyId: number;
            iteration: number;
            chainKey: Uint8Array;
            signingKey: Uint8Array;
            static create(properties: sma.v1.GroupKeyDistribution.$Shape): sma.v1.GroupKeyDistribution & sma.v1.GroupKeyDistribution.$Shape;
            static create(properties?: sma.v1.GroupKeyDistribution.$Properties): sma.v1.GroupKeyDistribution;
            static encode(m: sma.v1.GroupKeyDistribution.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.GroupKeyDistribution & sma.v1.GroupKeyDistribution.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.GroupKeyDistribution;
            static toObject(m: sma.v1.GroupKeyDistribution, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace GroupKeyDistribution {
            interface $Properties {
                groupId?: (Uint8Array|null);
                epoch?: (number|null);
                keyId?: (number|null);
                iteration?: (number|null);
                chainKey?: (Uint8Array|null);
                signingKey?: (Uint8Array|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.GroupKeyDistribution.$Properties;
        }

        interface IGroupControl extends sma.v1.GroupControl.$Properties {
        }

        class GroupControl {
            constructor(p?: sma.v1.GroupControl.$Properties);
            $unknowns?: Uint8Array[];
            groupId: Uint8Array;
            epoch: number;
            parentHash: Uint8Array;
            create?: (sma.v1.GroupCreate.$Properties|null);
            add?: (sma.v1.MemberChange.$Properties|null);
            remove?: (sma.v1.MemberChange.$Properties|null);
            metadata?: (sma.v1.GroupMetadata.$Properties|null);
            op?: ("create"|"add"|"remove"|"metadata");
            static create(properties: sma.v1.GroupControl.$Shape): sma.v1.GroupControl & sma.v1.GroupControl.$Shape;
            static create(properties?: sma.v1.GroupControl.$Properties): sma.v1.GroupControl;
            static encode(m: sma.v1.GroupControl.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.GroupControl & sma.v1.GroupControl.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.GroupControl;
            static toObject(m: sma.v1.GroupControl, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace GroupControl {
            interface $Properties {
                groupId?: (Uint8Array|null);
                epoch?: (number|null);
                parentHash?: (Uint8Array|null);
                create?: (sma.v1.GroupCreate.$Properties|null);
                add?: (sma.v1.MemberChange.$Properties|null);
                remove?: (sma.v1.MemberChange.$Properties|null);
                metadata?: (sma.v1.GroupMetadata.$Properties|null);
                op?: ("create"|"add"|"remove"|"metadata");
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              groupId?: Uint8Array|null;
              epoch?: number|null;
              parentHash?: Uint8Array|null;
              create?: sma.v1.GroupCreate.$Shape|null;
              add?: sma.v1.MemberChange.$Shape|null;
              remove?: sma.v1.MemberChange.$Shape|null;
              metadata?: sma.v1.GroupMetadata.$Shape|null;
              $unknowns?: Uint8Array[];
            } & (
              ({ op?: undefined; create?: null; add?: null; remove?: null; metadata?: null }|{ op?: "create"; create: sma.v1.GroupCreate.$Shape; add?: null; remove?: null; metadata?: null }|{ op?: "add"; create?: null; add: sma.v1.MemberChange.$Shape; remove?: null; metadata?: null }|{ op?: "remove"; create?: null; add?: null; remove: sma.v1.MemberChange.$Shape; metadata?: null }|{ op?: "metadata"; create?: null; add?: null; remove?: null; metadata: sma.v1.GroupMetadata.$Shape })
            );
        }

        interface IGroupCreate extends sma.v1.GroupCreate.$Properties {
        }

        class GroupCreate {
            constructor(p?: sma.v1.GroupCreate.$Properties);
            $unknowns?: Uint8Array[];
            members: Uint8Array[];
            admins: Uint8Array[];
            metadata?: (sma.v1.GroupMetadata.$Properties|null);
            static create(properties: sma.v1.GroupCreate.$Shape): sma.v1.GroupCreate & sma.v1.GroupCreate.$Shape;
            static create(properties?: sma.v1.GroupCreate.$Properties): sma.v1.GroupCreate;
            static encode(m: sma.v1.GroupCreate.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.GroupCreate & sma.v1.GroupCreate.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.GroupCreate;
            static toObject(m: sma.v1.GroupCreate, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace GroupCreate {
            interface $Properties {
                members?: (Uint8Array[]|null);
                admins?: (Uint8Array[]|null);
                metadata?: (sma.v1.GroupMetadata.$Properties|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              members?: Uint8Array[]|null;
              admins?: Uint8Array[]|null;
              metadata?: sma.v1.GroupMetadata.$Shape|null;
              $unknowns?: Uint8Array[];
            };
        }

        interface IMemberChange extends sma.v1.MemberChange.$Properties {
        }

        class MemberChange {
            constructor(p?: sma.v1.MemberChange.$Properties);
            $unknowns?: Uint8Array[];
            members: Uint8Array[];
            static create(properties: sma.v1.MemberChange.$Shape): sma.v1.MemberChange & sma.v1.MemberChange.$Shape;
            static create(properties?: sma.v1.MemberChange.$Properties): sma.v1.MemberChange;
            static encode(m: sma.v1.MemberChange.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.MemberChange & sma.v1.MemberChange.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.MemberChange;
            static toObject(m: sma.v1.MemberChange, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace MemberChange {
            interface $Properties {
                members?: (Uint8Array[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.MemberChange.$Properties;
        }

        interface IGroupMetadata extends sma.v1.GroupMetadata.$Properties {
        }

        class GroupMetadata {
            constructor(p?: sma.v1.GroupMetadata.$Properties);
            $unknowns?: Uint8Array[];
            title: string;
            avatarSha256: Uint8Array;
            avatarLocators: sma.v1.Locator.$Properties[];
            static create(properties: sma.v1.GroupMetadata.$Shape): sma.v1.GroupMetadata & sma.v1.GroupMetadata.$Shape;
            static create(properties?: sma.v1.GroupMetadata.$Properties): sma.v1.GroupMetadata;
            static encode(m: sma.v1.GroupMetadata.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.GroupMetadata & sma.v1.GroupMetadata.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.GroupMetadata;
            static toObject(m: sma.v1.GroupMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace GroupMetadata {
            interface $Properties {
                title?: (string|null);
                avatarSha256?: (Uint8Array|null);
                avatarLocators?: (sma.v1.Locator.$Properties[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              title?: string|null;
              avatarSha256?: Uint8Array|null;
              avatarLocators?: sma.v1.Locator.$Shape[]|null;
              $unknowns?: Uint8Array[];
            };
        }

        interface IReceipt extends sma.v1.Receipt.$Properties {
        }

        class Receipt {
            constructor(p?: sma.v1.Receipt.$Properties);
            $unknowns?: Uint8Array[];
            type: sma.v1.Receipt.Type;
            messageIds: Uint8Array[];
            static create(properties: sma.v1.Receipt.$Shape): sma.v1.Receipt & sma.v1.Receipt.$Shape;
            static create(properties?: sma.v1.Receipt.$Properties): sma.v1.Receipt;
            static encode(m: sma.v1.Receipt.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.Receipt & sma.v1.Receipt.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.Receipt;
            static toObject(m: sma.v1.Receipt, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace Receipt {
            interface $Properties {
                type?: (sma.v1.Receipt.Type|null);
                messageIds?: (Uint8Array[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.Receipt.$Properties;

            enum Type {
                TYPE_UNSPECIFIED = 0,
                DELIVERED = 1,
                READ = 2
            }
        }

        interface IReaction extends sma.v1.Reaction.$Properties {
        }

        class Reaction {
            constructor(p?: sma.v1.Reaction.$Properties);
            $unknowns?: Uint8Array[];
            targetId: Uint8Array;
            emoji: string;
            remove: boolean;
            static create(properties: sma.v1.Reaction.$Shape): sma.v1.Reaction & sma.v1.Reaction.$Shape;
            static create(properties?: sma.v1.Reaction.$Properties): sma.v1.Reaction;
            static encode(m: sma.v1.Reaction.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.Reaction & sma.v1.Reaction.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.Reaction;
            static toObject(m: sma.v1.Reaction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace Reaction {
            interface $Properties {
                targetId?: (Uint8Array|null);
                emoji?: (string|null);
                remove?: (boolean|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.Reaction.$Properties;
        }

        interface IEdit extends sma.v1.Edit.$Properties {
        }

        class Edit {
            constructor(p?: sma.v1.Edit.$Properties);
            $unknowns?: Uint8Array[];
            targetId: Uint8Array;
            text?: (sma.v1.Text.$Properties|null);
            static create(properties: sma.v1.Edit.$Shape): sma.v1.Edit & sma.v1.Edit.$Shape;
            static create(properties?: sma.v1.Edit.$Properties): sma.v1.Edit;
            static encode(m: sma.v1.Edit.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.Edit & sma.v1.Edit.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.Edit;
            static toObject(m: sma.v1.Edit, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace Edit {
            interface $Properties {
                targetId?: (Uint8Array|null);
                text?: (sma.v1.Text.$Properties|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.Edit.$Properties;
        }

        interface IDelete extends sma.v1.Delete.$Properties {
        }

        class Delete {
            constructor(p?: sma.v1.Delete.$Properties);
            $unknowns?: Uint8Array[];
            targetIds: Uint8Array[];
            static create(properties: sma.v1.Delete.$Shape): sma.v1.Delete & sma.v1.Delete.$Shape;
            static create(properties?: sma.v1.Delete.$Properties): sma.v1.Delete;
            static encode(m: sma.v1.Delete.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.Delete & sma.v1.Delete.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.Delete;
            static toObject(m: sma.v1.Delete, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace Delete {
            interface $Properties {
                targetIds?: (Uint8Array[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.Delete.$Properties;
        }

        interface ITyping extends sma.v1.Typing.$Properties {
        }

        class Typing {
            constructor(p?: sma.v1.Typing.$Properties);
            $unknowns?: Uint8Array[];
            started: boolean;
            static create(properties: sma.v1.Typing.$Shape): sma.v1.Typing & sma.v1.Typing.$Shape;
            static create(properties?: sma.v1.Typing.$Properties): sma.v1.Typing;
            static encode(m: sma.v1.Typing.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.Typing & sma.v1.Typing.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.Typing;
            static toObject(m: sma.v1.Typing, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace Typing {
            interface $Properties {
                started?: (boolean|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.Typing.$Properties;
        }

        interface IDeviceSync extends sma.v1.DeviceSync.$Properties {
        }

        class DeviceSync {
            constructor(p?: sma.v1.DeviceSync.$Properties);
            $unknowns?: Uint8Array[];
            newDevice?: (sma.v1.SignedBlob.$Properties|null);
            revokedDeviceId?: (Uint8Array|null);
            contactsSnapshotSha256?: (Uint8Array|null);
            historySnapshot?: (sma.v1.BlobRef.$Properties|null);
            kind?: ("newDevice"|"revokedDeviceId"|"contactsSnapshotSha256"|"historySnapshot");
            static create(properties: sma.v1.DeviceSync.$Shape): sma.v1.DeviceSync & sma.v1.DeviceSync.$Shape;
            static create(properties?: sma.v1.DeviceSync.$Properties): sma.v1.DeviceSync;
            static encode(m: sma.v1.DeviceSync.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.DeviceSync & sma.v1.DeviceSync.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.DeviceSync;
            static toObject(m: sma.v1.DeviceSync, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace DeviceSync {
            interface $Properties {
                newDevice?: (sma.v1.SignedBlob.$Properties|null);
                revokedDeviceId?: (Uint8Array|null);
                contactsSnapshotSha256?: (Uint8Array|null);
                historySnapshot?: (sma.v1.BlobRef.$Properties|null);
                kind?: ("newDevice"|"revokedDeviceId"|"contactsSnapshotSha256"|"historySnapshot");
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              newDevice?: sma.v1.SignedBlob.$Shape|null;
              revokedDeviceId?: Uint8Array|null;
              contactsSnapshotSha256?: Uint8Array|null;
              historySnapshot?: sma.v1.BlobRef.$Shape|null;
              $unknowns?: Uint8Array[];
            } & (
              ({ kind?: undefined; newDevice?: null; revokedDeviceId?: null; contactsSnapshotSha256?: null; historySnapshot?: null }|{ kind?: "newDevice"; newDevice: sma.v1.SignedBlob.$Shape; revokedDeviceId?: null; contactsSnapshotSha256?: null; historySnapshot?: null }|{ kind?: "revokedDeviceId"; newDevice?: null; revokedDeviceId: Uint8Array; contactsSnapshotSha256?: null; historySnapshot?: null }|{ kind?: "contactsSnapshotSha256"; newDevice?: null; revokedDeviceId?: null; contactsSnapshotSha256: Uint8Array; historySnapshot?: null }|{ kind?: "historySnapshot"; newDevice?: null; revokedDeviceId?: null; contactsSnapshotSha256?: null; historySnapshot: sma.v1.BlobRef.$Shape })
            );
        }

        interface IPrekeyRefresh extends sma.v1.PrekeyRefresh.$Properties {
        }

        class PrekeyRefresh {
            constructor(p?: sma.v1.PrekeyRefresh.$Properties);
            $unknowns?: Uint8Array[];
            bundle?: (sma.v1.SignedBlob.$Properties|null);
            static create(properties: sma.v1.PrekeyRefresh.$Shape): sma.v1.PrekeyRefresh & sma.v1.PrekeyRefresh.$Shape;
            static create(properties?: sma.v1.PrekeyRefresh.$Properties): sma.v1.PrekeyRefresh;
            static encode(m: sma.v1.PrekeyRefresh.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.PrekeyRefresh & sma.v1.PrekeyRefresh.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.PrekeyRefresh;
            static toObject(m: sma.v1.PrekeyRefresh, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace PrekeyRefresh {
            interface $Properties {
                bundle?: (sma.v1.SignedBlob.$Properties|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.PrekeyRefresh.$Properties;
        }

        interface IPluginMessage extends sma.v1.PluginMessage.$Properties {
        }

        class PluginMessage {
            constructor(p?: sma.v1.PluginMessage.$Properties);
            $unknowns?: Uint8Array[];
            pluginId: string;
            schemaVersion: number;
            payload: Uint8Array;
            static create(properties: sma.v1.PluginMessage.$Shape): sma.v1.PluginMessage & sma.v1.PluginMessage.$Shape;
            static create(properties?: sma.v1.PluginMessage.$Properties): sma.v1.PluginMessage;
            static encode(m: sma.v1.PluginMessage.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.PluginMessage & sma.v1.PluginMessage.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.PluginMessage;
            static toObject(m: sma.v1.PluginMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace PluginMessage {
            interface $Properties {
                pluginId?: (string|null);
                schemaVersion?: (number|null);
                payload?: (Uint8Array|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = sma.v1.PluginMessage.$Properties;
        }

        interface IPluginManifest extends sma.v1.PluginManifest.$Properties {
        }

        class PluginManifest {
            constructor(p?: sma.v1.PluginManifest.$Properties);
            $unknowns?: Uint8Array[];
            id: string;
            name: string;
            version: string;
            developerKey: Uint8Array;
            permissions: string[];
            bundleSha256: Uint8Array;
            bundleLocators: sma.v1.Locator.$Properties[];
            static create(properties: sma.v1.PluginManifest.$Shape): sma.v1.PluginManifest & sma.v1.PluginManifest.$Shape;
            static create(properties?: sma.v1.PluginManifest.$Properties): sma.v1.PluginManifest;
            static encode(m: sma.v1.PluginManifest.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.PluginManifest & sma.v1.PluginManifest.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.PluginManifest;
            static toObject(m: sma.v1.PluginManifest, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace PluginManifest {
            interface $Properties {
                id?: (string|null);
                name?: (string|null);
                version?: (string|null);
                developerKey?: (Uint8Array|null);
                permissions?: (string[]|null);
                bundleSha256?: (Uint8Array|null);
                bundleLocators?: (sma.v1.Locator.$Properties[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              id?: string|null;
              name?: string|null;
              version?: string|null;
              developerKey?: Uint8Array|null;
              permissions?: string[]|null;
              bundleSha256?: Uint8Array|null;
              bundleLocators?: sma.v1.Locator.$Shape[]|null;
              $unknowns?: Uint8Array[];
            };
        }

        interface IBackupManifest extends sma.v1.BackupManifest.$Properties {
        }

        class BackupManifest {
            constructor(p?: sma.v1.BackupManifest.$Properties);
            $unknowns?: Uint8Array[];
            version: number;
            createdAtMs: (number|Long);
            contacts: sma.v1.BlobRef.$Properties[];
            groups: sma.v1.BlobRef.$Properties[];
            history: sma.v1.BlobRef.$Properties[];
            static create(properties: sma.v1.BackupManifest.$Shape): sma.v1.BackupManifest & sma.v1.BackupManifest.$Shape;
            static create(properties?: sma.v1.BackupManifest.$Properties): sma.v1.BackupManifest;
            static encode(m: sma.v1.BackupManifest.$Properties, w?: $protobuf.Writer): $protobuf.Writer;
            static decode(r: ($protobuf.Reader|Uint8Array), l?: number): sma.v1.BackupManifest & sma.v1.BackupManifest.$Shape;
            static verify(m: { [k: string]: any }): (string|null);
            static fromObject(d: { [k: string]: any }): sma.v1.BackupManifest;
            static toObject(m: sma.v1.BackupManifest, o?: $protobuf.IConversionOptions): { [k: string]: any };
            toJSON(): { [k: string]: any };
            static getTypeUrl(prefix?: string): string;
        }

        namespace BackupManifest {
            interface $Properties {
                version?: (number|null);
                createdAtMs?: (number|Long|null);
                contacts?: (sma.v1.BlobRef.$Properties[]|null);
                groups?: (sma.v1.BlobRef.$Properties[]|null);
                history?: (sma.v1.BlobRef.$Properties[]|null);
                $unknowns?: Uint8Array[];
            }
            type $Shape = {
              version?: number|null;
              createdAtMs?: number|Long|null;
              contacts?: sma.v1.BlobRef.$Shape[]|null;
              groups?: sma.v1.BlobRef.$Shape[]|null;
              history?: sma.v1.BlobRef.$Shape[]|null;
              $unknowns?: Uint8Array[];
            };
        }
    }
}
