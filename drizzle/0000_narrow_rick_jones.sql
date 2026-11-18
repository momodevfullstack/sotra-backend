CREATE TABLE `adhérents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`numero` varchar(50) NOT NULL,
	`nom` varchar(100) NOT NULL,
	`prenoms` varchar(150) NOT NULL,
	`sexe` varchar(20),
	`date_naissance` datetime,
	`telephone` varchar(30),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `adhérents_id` PRIMARY KEY(`id`),
	CONSTRAINT `adhérents_numero_unique` UNIQUE(`numero`)
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`matricule` varchar(50) NOT NULL,
	`nom` varchar(100) NOT NULL,
	`prenoms` varchar(150) NOT NULL,
	`email` varchar(100),
	`telephone` varchar(30),
	`poste` varchar(100),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `agents_id` PRIMARY KEY(`id`),
	CONSTRAINT `agents_matricule_unique` UNIQUE(`matricule`)
);
--> statement-breakpoint
CREATE TABLE `bons` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`numero_bon` varchar(50) NOT NULL,
	`montant` int NOT NULL,
	`statut` varchar(50) NOT NULL DEFAULT 'en_attente',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `bons_id` PRIMARY KEY(`id`),
	CONSTRAINT `bons_numero_bon_unique` UNIQUE(`numero_bon`)
);
