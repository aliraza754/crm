"use client";

import { emailOtp, signIn } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
	CODE_LENGTH,
	CODE_MINUTES,
	cleanCode,
	isCompleteCode,
	LINK_MINUTES,
} from "@/lib/email-code";

type Step =
	| { name: "email" }
	| { name: "code"; email: string }
	| { name: "link"; email: string };

type Outcome = { error: { message?: string } | null };

const UNREACHABLE = "Could not reach the sign-in service.";

export function EmailSignIn() {
	const [step, setStep] = useState<Step>({ name: "email" });
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [pending, setPending] = useState(false);

	async function attempt(request: () => Promise<Outcome>): Promise<boolean> {
		setPending(true);

		try {
			const { error } = await request();
			if (error) {
				toast.error(error.message ?? UNREACHABLE);
				return false;
			}
			return true;
		} catch {
			toast.error(UNREACHABLE);
			return false;
		} finally {
			setPending(false);
		}
	}

	async function handleSendCode(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		const address = email.trim();
		const sent = await attempt(() =>
			emailOtp.sendVerificationOtp({ email: address, type: "sign-in" }),
		);
		if (!sent) return;

		setCode("");
		setStep({ name: "code", email: address });
	}

	async function handleSendLink() {
		const address = email.trim();
		if (!address) {
			toast.error("Enter your work email first.");
			return;
		}

		const origin = window.location.origin;
		const sent = await attempt(() =>
			signIn.magicLink({
				email: address,
				callbackURL: `${origin}/`,
				errorCallbackURL: `${origin}/sign-in`,
			}),
		);
		if (sent) setStep({ name: "link", email: address });
	}

	async function handleVerify(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (step.name !== "code" || !isCompleteCode(code)) return;

		const signedIn = await attempt(() =>
			signIn.emailOtp({ email: step.email, otp: code }),
		);
		if (signedIn) window.location.assign("/");
	}

	function handleRestart() {
		setCode("");
		setStep({ name: "email" });
	}

	if (step.name === "link") {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm/5 text-muted-foreground">
					We emailed a sign-in link to {step.email}. Open it on this device. It
					works once, for {LINK_MINUTES} minutes.
				</p>
				<Button
					className="w-full"
					onClick={handleRestart}
					type="button"
					variant="outline"
				>
					Back
				</Button>
			</div>
		);
	}

	if (step.name === "code") {
		return (
			<form className="flex flex-col gap-3" onSubmit={handleVerify}>
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor="sign-in-code">Sign-in code</FieldLabel>
						<Input
							id="sign-in-code"
							name="code"
							autoComplete="one-time-code"
							disabled={pending}
							inputMode="numeric"
							maxLength={CODE_LENGTH}
							onChange={(event) => setCode(cleanCode(event.target.value))}
							pattern="[0-9]*"
							required
							value={code}
						/>
						<FieldDescription>
							We sent a {CODE_LENGTH}-digit code to {step.email}. It works once,
							for {CODE_MINUTES} minutes.
						</FieldDescription>
					</Field>
				</FieldGroup>
				<Button
					className="w-full"
					disabled={pending || !isCompleteCode(code)}
					type="submit"
				>
					{pending ? <Spinner data-icon="inline-start" /> : null}
					Sign in
				</Button>
				<Button
					className="w-full"
					disabled={pending}
					onClick={handleRestart}
					type="button"
					variant="outline"
				>
					Use a different email
				</Button>
			</form>
		);
	}

	return (
		<form className="flex flex-col gap-3" onSubmit={handleSendCode}>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor="sign-in-email">Work email</FieldLabel>
					<Input
						id="sign-in-email"
						name="email"
						autoComplete="email"
						disabled={pending}
						inputMode="email"
						onChange={(event) => setEmail(event.target.value)}
						placeholder="you@company.com"
						required
						type="email"
						value={email}
					/>
				</Field>
			</FieldGroup>
			<Button className="w-full" disabled={pending} type="submit">
				{pending ? <Spinner data-icon="inline-start" /> : null}
				Email me a sign-in code
			</Button>
			<Button
				className="w-full"
				disabled={pending}
				onClick={handleSendLink}
				type="button"
				variant="outline"
			>
				Email me a link instead
			</Button>
		</form>
	);
}
