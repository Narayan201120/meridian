-- Store Web Push payload-encryption keys on devices.
--
-- Reminders never reached users because the server POSTed plaintext JSON while
-- claiming Content-Encoding: aes128gcm: the push service accepted the message
-- and the delivery row said `sent`, but no browser could decrypt the body.
-- Web Push requires the payload to be encrypted per RFC 8291 with the
-- subscription's own keys, which the server accepted at registration and then
-- discarded. These columns keep the keys alongside the endpoint they belong
-- to, so delivery can encrypt for a device instead of logging a lie about it.
--
-- A browser rotates its keys on re-subscribe, so registration overwrites them;
-- a stale key encrypts for a point the browser no longer holds. Devices
-- registered before this column existed hold NULL and cannot be encrypted
-- for: delivery records those FAILED with a re-register explanation rather
-- than sending undecryptable bytes.
alter table public.devices add column if not exists push_p256dh text;
alter table public.devices add column if not exists push_auth text;
